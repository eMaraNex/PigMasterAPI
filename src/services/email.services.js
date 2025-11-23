import dotenv from 'dotenv';
dotenv.config();
import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import os from 'os';
import { DatabaseHelper } from '../config/database.js';

/**
 * Email Service using Nodemailer with rate limiting
 */
class EmailService {
    constructor(config = {}, logger, dailyLimit) {
        this.config = {
            service: process.env.EMAIL_SERVICE || 'gmail',
            user: process.env.SMTP_USER,
            defaultSender: process.env.DEFAULT_SENDER_EMAIL,
            dailyLimit: dailyLimit || 500,
            ...config
        };

        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        this.emailsSentToday = 0;
        this.logger = logger || console;
        this.initialize();
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
                url: process.env.NODE_ENV === 'production' ? process.env.PROD_BACKEND_URL : process.env.DEV_BACKEND_URL,
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
            html
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
            // Check daily limit
            if (this.emailsSentToday >= this.config.dailyLimit) {
                this.logger.error(`Daily email limit reached: ${this.emailsSentToday}/${this.config.dailyLimit}`);
                return { success: false, status: 'limit_reached', message: 'Daily email limit reached' };
            }

            const message = await this.createMessage(options, type);
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