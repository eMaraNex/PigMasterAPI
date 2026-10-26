import { pool } from '../config/database.js';
import logger from '../middleware/logger.js';
import EmailService from './email.services.js';

/*
 * Trial and plan reminders, run once a day by a UTC cron.
 *
 * Stages (by UTC calendar days between today and the end date):
 *   before_5  3–5 days left      before_2  2 days left      before_1  last day
 *   ended     0–2 days after     after_3   3–7 days after (one follow-up)
 * Each (subscription, stage) is recorded in subscription_notices before sending, so an
 * email goes out at most once even with several API instances, restarts or a missed day.
 * At most REMINDER_EMAILS_PER_RUN emails are sent per run to protect the email package.
 */
const MAX_PER_RUN = Number.parseInt(process.env.REMINDER_EMAILS_PER_RUN ?? '100', 10) || 100;
const LOCK = "hashtext('subscriptions:reminders')";
const NAIROBI_DATE = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'long', year: 'numeric' });

export const reminderStage = (daysLeft, ended) => {
  if (ended) {
    if (daysLeft >= -2) return 'ended';
    if (daysLeft >= -7 && daysLeft <= -3) return 'after_3';
    return null;
  }
  if (daysLeft >= 3 && daysLeft <= 5) return 'before_5';
  if (daysLeft === 2) return 'before_2';
  if (daysLeft <= 1) return 'before_1';
  return null;
};

const clientUrl = () => (process.env.NODE_ENV === 'production' ? process.env.PROD_CLIENT_BASE_URL : process.env.DEV_CLIENT_BASE_URL);

/** Subject and body for one reminder. */
export const reminderMessage = ({ name, kind, plan, stage, endsAt, daysLeft }) => {
  const product = kind === 'trial' ? 'your PigMaster free trial' : `your PigMaster ${plan} plan`;
  const Product = product.charAt(0).toUpperCase() + product.slice(1);
  const date = NAIROBI_DATE.format(new Date(endsAt));
  const link = `${clientUrl()}/pricing`;
  const action = kind === 'trial' ? 'Choose a plan' : 'Renew your plan';
  const yearly = 'Tip: paying yearly saves 16% and covers 12 months with one M-Pesa payment.';
  const copy = {
    before_5: [`${Product} ends in ${daysLeft} days`, `${Product} ends on ${date}. ${action} with M-Pesa before then to keep using breeding, health, feeding, reports and team access without interruption.`],
    before_2: [`${Product} ends in 2 days`, `Just a reminder: ${product} ends on ${date}. ${action} now so nothing stops on your farm.`],
    before_1: [`${Product} ends tomorrow`, `${Product} ends on ${date}. ${action} today to keep full access.`],
    ended: [`${Product} has ended`, `${Product} ended on ${date}. Your farm records are safe. ${action} to switch premium features back on.`],
    after_3: [`We have kept your farm records safe`, `${Product} ended on ${date}, so premium features are paused. Your pigs, health and sales records are all still there. ${action} whenever you are ready.`],
  }[stage];
  return {
    subject: copy[0],
    text: `Hi ${name || 'there'},\n\n${copy[1]}\n\n${action}: ${link}\n\n${yearly}\n\nPigMaster`,
  };
};

/** Finds due reminders, records each one, then emails it (once). */
export const processSubscriptionReminders = async (now = new Date()) => {
  const client = await pool.connect();
  try {
    const lock = await client.query(`SELECT pg_try_advisory_lock(${LOCK}) AS acquired`);
    if (!lock.rows[0].acquired) return { skipped: true };
    try {
      // Latest subscription per farmer; its trial or paid end date drives the reminders.
      const { rows } = await client.query(
        `WITH latest AS (
           SELECT DISTINCT ON (s.user_id) s.* FROM subscriptions s
           WHERE s.is_active = 1 ORDER BY s.user_id, s.created_at DESC
         ), due AS (
           SELECT l.id AS subscription_id, l.user_id, u.email, u.name, l.current_plan,
                  CASE WHEN l.status = 'trial' OR l.current_plan = 'trial' THEN 'trial' ELSE 'plan' END AS kind,
                  CASE WHEN l.status = 'trial' OR l.current_plan = 'trial' THEN l.trial_end_date ELSE l.expiry_date END AS ends_at
           FROM latest l
           JOIN users u ON u.id = l.user_id AND u.is_deleted = 0 AND u.is_active = 1 AND u.admin_role_id IS NULL
           -- Never spend the email quota on reserved test domains (demo/sample accounts).
           WHERE u.email !~* '@([a-z0-9-]+\\.)*(test|example|invalid|localhost)$' AND u.email !~* '@example\\.(com|org|net)$'
         )
         SELECT d.*,
                (d.ends_at AT TIME ZONE 'UTC')::date - ($1::timestamptz AT TIME ZONE 'UTC')::date AS days_left,
                d.ends_at <= $1::timestamptz AS ended
         FROM due d
         WHERE d.ends_at BETWEEN $1::timestamptz - INTERVAL '8 days' AND $1::timestamptz + INTERVAL '6 days'
         ORDER BY d.ends_at
         LIMIT 2000`,
        [now]
      );

      let sent = 0;
      let failed = 0;
      const mailer = new EmailService({}, logger);
      for (const row of rows) {
        if (sent + failed >= MAX_PER_RUN) break;
        const stage = reminderStage(Number(row.days_left), row.ended);
        if (!stage) continue;
        // Claim the notice first: a second instance or a re-run cannot send it again.
        const claimed = await client.query(
          `INSERT INTO subscription_notices (subscription_id, user_id, kind, stage, ends_at)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (subscription_id, stage) DO NOTHING RETURNING id`,
          [row.subscription_id, row.user_id, row.kind, stage, row.ends_at]
        );
        if (!claimed.rows.length) continue;
        const message = reminderMessage({
          name: row.name, kind: row.kind, plan: row.current_plan, stage, endsAt: row.ends_at, daysLeft: Number(row.days_left),
        });
        let ok = false;
        try {
          const result = await mailer.sendEmail({ to: row.email, ...message, appName: 'PigMaster', user_id: row.user_id }, 'subscription_reminder');
          ok = Boolean(result?.success);
          if (result?.status === 'limit_reached') {
            await client.query(`UPDATE subscription_notices SET email_status = 'failed' WHERE id = $1`, [claimed.rows[0].id]);
            logger.warn('Email limit reached; remaining subscription reminders wait for the next run');
            break;
          }
        } catch (error) {
          logger.warn(`Subscription reminder to ${row.email} failed: ${error.message}`);
        }
        await client.query(`UPDATE subscription_notices SET email_status = $2 WHERE id = $1`, [claimed.rows[0].id, ok ? 'sent' : 'failed']);
        if (ok) sent += 1; else failed += 1;
      }
      if (sent || failed) logger.info(`Subscription reminders: ${sent} sent, ${failed} failed`);
      return { candidates: rows.length, sent, failed };
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${LOCK})`);
    }
  } finally {
    client.release();
  }
};
