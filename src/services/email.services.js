import dotenv from 'dotenv';
import { apiBaseUrl } from '../config/urls.js';
dotenv.config();
import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import os from 'os';
import { DatabaseHelper } from '../config/database.js';

/** Email types that give way to sign-in, password and invite emails when the daily quota runs low. */
const BULK_TYPES = new Set(['general', 'alert_notification', 'subscription_reminder']);

// Ports that speak TLS from the first byte; every other port (587, 2587, 25) starts plain and upgrades (STARTTLS).
const IMPLICIT_TLS_PORTS = new Set([465, 2465]);
const env = name => String(process.env[name] ?? '').trim().replace(/^["']|["']$/g, '');
let smtpWarned = false;

/**
 * SMTP settings for any provider: Resend (smtp.resend.com, 465 or 587, user "resend") or Gmail (587).
 * The TLS mode always follows the port, so a leftover SMTP_SECURE cannot cause
 * "wrong version number" (TLS on a STARTTLS port) or a hang (plain text on a TLS port).
 */
export const smtpOptions = () => {
    const port = Number.parseInt(env('SMTP_PORT'), 10) || 587;
    const secure = IMPLICIT_TLS_PORTS.has(port);
    const requested = env('SMTP_SECURE').toLowerCase();
    if (!smtpWarned && requested && (requested === 'true') !== secure) {
        smtpWarned = true;
        console.warn(`SMTP_SECURE=${requested} does not match port ${port}; using ${secure ? 'TLS' : 'STARTTLS'} for that port.`);
    }
    return {
        host: env('SMTP_HOST') || 'smtp.gmail.com',
        port,
        secure,
        // On 587/2587 refuse to send unencrypted if the upgrade fails.
        requireTLS: !secure,
        auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
    };
};

// Resend allows a few requests a second; space sends out so loops (alerts, reminders) never hit it.
const MIN_GAP_MS = Number.parseInt(process.env.EMAIL_MIN_GAP_MS ?? '600', 10) || 0;
let nextSlot = 0;
const throttle = () => {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
    return wait ? new Promise(resolve => setTimeout(resolve, wait)) : Promise.resolve();
};

/**
 * Email Service using Nodemailer with rate limiting
 */
class EmailService {
    constructor(config = {}, logger, dailyLimit) {
        this.config = {
            service: process.env.EMAIL_SERVICE || 'gmail',
            user: process.env.SMTP_USER,
            defaultSender: env('DEFAULT_SENDER_EMAIL') || undefined,
            replyTo: env('EMAIL_REPLY_TO') || undefined,
            // Resend's free plan allows 100 emails a day.
            dailyLimit: dailyLimit || Number.parseInt(process.env.EMAIL_DAILY_LIMIT ?? '100', 10) || 100,
            // Emails kept back for sign-in, password reset, invites and error alerts.
            reserve: Number.parseInt(process.env.EMAIL_TRANSACTIONAL_RESERVE ?? '30', 10) || 0,
            ...config
        };

        this.transporter = nodemailer.createTransport(smtpOptions());

        this.emailsSentToday = 0;
        this.logger = logger || console;
        this.ready = this.initialize().catch(() => {});
    }

    /**
     * Initialize the service with email count from database
     */
    async initialize() {
        try {
            const today = new Date().toISOString().split('T')[0];

            // Check if email_logs table exists
            const tableCheck = await DatabaseHelper.executeQuery(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'email_logs'
            ) as table_exists
        `);

            if (!tableCheck.rows[0].table_exists) {
                this.logger.info('email_logs table does not exist. Initializing with zero emails sent.');
                this.emailsSentToday = 0;
                return;
            }

            // Proceed with original query if table exists
            const result = await DatabaseHelper.executeQuery(`
            SELECT COUNT(*) as count
            FROM email_logs
            WHERE date = $1
            AND is_deleted = 0
        `, [today]);

            this.emailsSentToday = parseInt(result.rows[0].count, 10) || 0;
            this.logger.info(`Email service initialized. Emails sent today: ${this.emailsSentToday}`);
        } catch (error) {
            this.logger.error(`Initialization error: ${error.message}`);
            throw error;
        }
    }

    /** Emails logged today (all instances); falls back to this instance's count. */
    async countSentToday() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const result = await DatabaseHelper.executeQuery(
                'SELECT COALESCE(SUM(count), 0)::int AS count FROM email_logs WHERE date = $1 AND is_deleted = 0', [today]);
            return Number(result.rows[0]?.count) || 0;
        } catch {
            return this.emailsSentToday;
        }
    }

    /**
     * Log email send to database
     */
    async logEmailSend(user_id, farm_id) {
        try {
            const today = new Date().toISOString().split('T')[0];
            await DatabaseHelper.executeQuery(`
                INSERT INTO email_logs (
                    id, user_id, farm_id, count, date, is_active, is_deleted, created_at, updated_at
                ) VALUES (
                    uuid_generate_v4(), $1, $2, 1, $3, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            `, [user_id || null, farm_id || null, today]);
            this.emailsSentToday++;
        } catch (error) {
            this.logger.error(`Error logging email send: ${error.message}`);
            throw error;
        }
    }

    /**
     * Check if two dates are the same day
     */
    isSameDay(date1, date2) {
        return (
            date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate()
        );
    }

    /**
     * Load template file from disk
     * @param {string} templatePath - Path to the template file
     * @returns {Promise<string>} - Template content
     */
    async loadTemplate(templatePath) {
        try {
            return await fs.readFile(templatePath, 'utf8');
        } catch (error) {
            this.logger.error(`Error loading template ${templatePath}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get system information for templates
     * @returns {Object} - System information
     */
    getSystemInfo() {
        return {
            machineName: os.hostname(),
            osInfo: `${os.type()} ${os.release()} ${os.arch()}`,
            username: os.userInfo().username,
            timestamp: new Date().toLocaleString()
        };
    }

    /**
     * Replace variables in the email template
     */
    updateTemplate(template, data) {
        return template.replace(/{{(\w+)}}/g, (_, key) => {
            return data[key] || '';
        });
    }

    /**
     * Create an email message object
     */
    async createMessage(options, type) {
        const {
            to,
            subject,
            text,
            from = this.config.defaultSender,
            attachments,
            templatePath,
            appName = 'Application'
        } = options;

        let html = text;
        if (templatePath) {
            const templateContent = await this.loadTemplate(templatePath);
            const templateData = {
                ...this.getSystemInfo(),
                appName,
                url: apiBaseUrl(),
                type: type,
                ...options
            };
            html = this.updateTemplate(templateContent, templateData);
        }

        const msg = {
            to,
            from,
            subject,
            text,
            html,
            ...(this.config.replyTo && { replyTo: this.config.replyTo })
        };

        if (attachments && Array.isArray(attachments)) {
            msg.attachments = attachments.map((attachment) => {
                const att = {
                    filename: attachment.filename,
                    contentType: attachment.contentType || attachment.type,
                    disposition: attachment.disposition || 'attachment'
                };
                if (attachment.path) {
                    att.path = attachment.path;
                } else if (attachment.content) {
                    if (!Buffer.isBuffer(attachment.content)) {
                        this.logger.error(`Attachment content is not a Buffer: ${typeof attachment.content}`);
                        throw new Error('Attachment content must be a Buffer');
                    }
                    att.content = attachment.content;
                }
                return att;
            });
        }

        return msg;
    }

    /**
     * Send an email immediately
     */
    async sendEmail(options, type = 'general') {
        try {
            await this.ready;
            // Today's count across every instance and process, not just this one.
            const sentToday = await this.countSentToday();
            // Bulk emails (alerts, reminders) stop early so the reserve stays for important ones.
            const limit = BULK_TYPES.has(type) ? this.config.dailyLimit - this.config.reserve : this.config.dailyLimit;
            if (sentToday >= limit) {
                this.logger.warn(`Daily email limit reached for ${type}: ${sentToday}/${limit}`);
                return { success: false, status: 'limit_reached', message: 'Daily email limit reached' };
            }

            const message = await this.createMessage(options, type);
            await throttle();
            await this.transporter.sendMail(message);
            await this.logEmailSend(options.user_id, options.farm_id);

            this.logger.info(`Email sent to ${message.to}. Daily count: ${this.emailsSentToday}/${this.config.dailyLimit}`);
            return { success: true, status: 'sent', message: 'Email sent successfully' };
        } catch (error) {
            this.logger.error(`Error sending email: ${error.message}`);
            return { success: false, status: 'error', message: error.message };
        }
    }

    /**
     * Get current status, optionally filtered by user_id and farm_id
     */
    async getStatus(user_id, farm_id) {
        try {
            const today = new Date().toISOString().split('T')[0];
            let query = `
                SELECT COUNT(*) as count
                FROM email_logs
                WHERE date = $1
                AND is_deleted = 0
            `;
            const params = [today];

            if (user_id) {
                query += ` AND user_id = $${params.length + 1}`;
                params.push(user_id);
            }
            if (farm_id) {
                query += ` AND farm_id = $${params.length + 1}`;
                params.push(farm_id);
            }

            const result = await DatabaseHelper.executeQuery(query, params);
            const count = parseInt(result.rows[0].count, 10) || 0;

            return {
                emailsSentToday: count,
                dailyLimit: this.config.dailyLimit,
                remainingQuota: this.config.dailyLimit - count
            };
        } catch (error) {
            this.logger.error(`Error getting email status: ${error.message}`);
            throw error;
        }
    }
}

export default EmailService;