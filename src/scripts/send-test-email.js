import dotenv from 'dotenv';

dotenv.config();
const { default: EmailService } = await import('../services/email.services.js');
const { pool } = await import('../config/database.js');

/** Sends one email with the current SMTP settings: npm run email:test -- you@example.com */
const to = process.argv[2];
if (!to) {
  console.error('Usage: npm run email:test -- you@example.com');
  process.exit(1);
}
const result = await new EmailService({}, console).sendEmail({
  to,
  subject: 'PigMaster test email',
  text: `This is a test email from PigMaster sent through ${process.env.SMTP_HOST}.\nIf you can read this, email is working.`,
  appName: 'PigMaster',
}, 'test');
console.log(result.success ? `Sent to ${to} from ${process.env.DEFAULT_SENDER_EMAIL}` : `Failed: ${result.message}`);
await pool.end();
process.exitCode = result.success ? 0 : 1;
