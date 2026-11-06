import os from 'os';
import logger from '../middleware/logger.js';

/*
 * Emails critical errors, with the stack trace, to ERROR_ALERT_EMAIL (e.g. develop@emaranex.com)
 * so the team sees them before customers report them. Off when ERROR_ALERT_EMAIL is not set.
 *
 * To protect the email quota, the same error (same title and top stack line) is sent at most
 * once per ERROR_ALERT_COOLDOWN_MINUTES, and at most ERROR_ALERT_MAX_PER_DAY alerts go out per
 * day per server process. Request bodies are never included (they can hold passwords).
 */
const COOLDOWN_MS = (Number.parseInt(process.env.ERROR_ALERT_COOLDOWN_MINUTES ?? '60', 10) || 60) * 60_000;
const MAX_PER_DAY = Number.parseInt(process.env.ERROR_ALERT_MAX_PER_DAY ?? '20', 10) || 20;

const lastSent = new Map();
let day = '';
let sentToday = 0;
let suppressed = 0;

const signature = (title, error) => `${title}|${String(error?.stack ?? error?.message ?? error).split('\n').slice(0, 2).join('|')}`;

/**
 * Reports a critical error. Never throws and never waits on the email, so callers can use
 * it anywhere (request handlers, crons, crash handlers).
 */
export const reportCriticalError = (title, error, context = {}) => {
  const to = process.env.ERROR_ALERT_EMAIL;
  if (!to || process.env.NODE_ENV === 'test') return Promise.resolve(false);

  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; sentToday = 0; }
  const key = signature(title, error);
  const now = Date.now();
  if ((lastSent.get(key) ?? 0) > now - COOLDOWN_MS || sentToday >= MAX_PER_DAY) {
    suppressed += 1;
    return Promise.resolve(false);
  }
  lastSent.set(key, now);
  sentToday += 1;
  if (lastSent.size > 500) lastSent.delete(lastSent.keys().next().value);

  const env = process.env.NODE_ENV || 'development';
  const details = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  const text = [
    `${title}`,
    '',
    `Error: ${error?.message ?? String(error)}`,
    `Environment: ${env} on ${os.hostname()}`,
    `Time (UTC): ${new Date().toISOString()}`,
    ...details,
    ...(suppressed ? [`Similar or extra alerts suppressed since the last one: ${suppressed}`] : []),
    '',
    'Stack trace:',
    error?.stack ?? '(none)',
  ].join('\n');
  suppressed = 0;

  return import('./email.services.js')
    .then(({ default: EmailService }) => new EmailService({}, logger).sendEmail({
      to,
      subject: `[PigMaster ${env}] ${title}: ${String(error?.message ?? error).slice(0, 120)}`,
      text,
      appName: 'PigMaster',
    }, 'error_alert'))
    .then(result => Boolean(result?.success))
    .catch(sendError => {
      logger.warn(`Could not send error alert: ${sendError.message}`);
      return false;
    });
};
