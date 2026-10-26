import Joi from 'joi';
import { randomBytes } from 'crypto';
import { DatabaseHelper } from '../../config/database.js';
import { ForbiddenError, ValidationError } from '../../middleware/errors.js';
import logger from '../../middleware/logger.js';
import EmailService from '../../services/email.services.js';
import { ConflictError } from '../helpers.js';

// Dashboard roles and the database roles behind them.
export const ADMIN_ROLES = { SUPER_ADMIN: 'superadmin', PARTNER: 'partner' };
const ROLE_LABELS = { superadmin: 'Super admin', partner: 'Partner (read-only analytics)' };
const LINK_HOURS = 72;

const inviteSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().lowercase().email().max(255).required(),
  phone: Joi.string().trim().pattern(/^\+?[0-9 ]{7,20}$/).allow('', null),
  role: Joi.string().valid(...Object.keys(ADMIN_ROLES)).required(),
});

const clientUrl = () => (process.env.NODE_ENV === 'production' ? process.env.PROD_CLIENT_BASE_URL : process.env.DEV_CLIENT_BASE_URL);
const dashboardUrl = () => process.env.ADMIN_DASHBOARD_URL || 'the PigMaster admin dashboard';

/** One-time set-password link (the farmer app's reset page sets the password for any account). */
const issueSetupLink = async (client, userId) => {
  const token = randomBytes(32).toString('hex');
  await client.query('UPDATE password_resets SET used = true WHERE user_id = $1 AND used = false', [userId]);
  await client.query(
    `INSERT INTO password_resets (user_id, token, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + make_interval(hours => $3))`,
    [userId, token, LINK_HOURS]
  );
  return token;
};

const sendAdminInvite = async ({ email, name, roleName, invitedBy, token }) => {
  const link = `${clientUrl()}/reset-password/${token}`;
  try {
    const result = await new EmailService({}, logger).sendEmail({
      to: email,
      subject: 'You have been added as a PigMaster admin',
      text: `Hi ${name},\n\n${invitedBy} added you as a ${roleName} on PigMaster.\n`
        + `Set your password (link valid for ${LINK_HOURS} hours): ${link}\n`
        + `Then sign in at ${dashboardUrl()} with this email address.\n`,
      appName: 'PigMaster',
    }, 'admin_invite');
    return Boolean(result?.success);
  } catch (error) {
    logger.warn(`Admin invite email to ${email} failed: ${error.message}`);
    return false;
  }
};

/** Super admins still able to sign in, excluding `exceptUserId`. */
const otherActiveSuperAdmins = async (client, exceptUserId) => {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'superadmin' AND u.is_active = 1 AND u.is_deleted = 0 AND u.id <> $1`,
    [exceptUserId]
  );
  return rows[0].n;
};

export const adminUserHooks = {
  async beforeUpdate(ctx, user, data) {
    if (user.id === ctx.admin.id) throw new ForbiddenError('You cannot change your own role or access');
    // Role arrives as SUPER_ADMIN / PARTNER and is stored as the matching roles row.
    if (data.role !== undefined) {
      const { rows } = await ctx.client.query('SELECT id FROM roles WHERE name = $1', [ADMIN_ROLES[data.role]]);
      data.role_id = rows[0].id;
    }
    const demoting = data.role !== undefined && data.role !== 'SUPER_ADMIN';
    const suspending = data.is_active === false;
    if ((demoting || suspending) && !(await otherActiveSuperAdmins(ctx.client, user.id))) {
      throw new ValidationError('At least one active super admin must remain');
    }
    delete data.role;
  },
};

/** Adds an admin: creates the account and emails a set-password link. */
export const inviteAdmin = async (ctx, body) => {
  const { error, value } = inviteSchema.validate(body ?? {}, { abortEarly: false, stripUnknown: true });
  if (error) throw new ValidationError(`Validation error: ${error.details.map(detail => detail.message).join(', ')}`);
  const roleName = ADMIN_ROLES[value.role];

  const created = await DatabaseHelper.withTransaction(async client => {
    const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = $1 AND is_deleted = 0', [value.email]);
    if (existing.rows.length) {
      throw new ConflictError(`${value.email} already has a PigMaster account. Use a separate email address for admin access.`);
    }
    const { rows } = await client.query(
      `INSERT INTO users (email, name, phone, role_id, provider, email_verified)
       VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name = $4), 'local', false) RETURNING id`,
      [value.email, value.name, value.phone || null, roleName]
    );
    const token = await issueSetupLink(client, rows[0].id);
    return { id: rows[0].id, token };
  });

  const emailSent = await sendAdminInvite({
    email: value.email, name: value.name, roleName: ROLE_LABELS[roleName], invitedBy: ctx.admin.name ?? 'A PigMaster admin', token: created.token,
  });
  return { id: created.id, email: value.email, email_sent: emailSent, expires_in_hours: LINK_HOURS };
};

/** New set-password link for an admin who never finished their invite. */
export const resendAdminInvite = async (ctx, service, id) => {
  const admin = await service.getById(ctx, id);
  if (admin.password_set) throw new ValidationError(`${admin.name} has already set a password; they can use "Forgot password"`);
  if (!admin.is_active) throw new ValidationError('Reactivate this admin before resending the invite');
  const token = await DatabaseHelper.withTransaction(client => issueSetupLink(client, admin.id));
  const emailSent = await sendAdminInvite({
    email: admin.email, name: admin.name, roleName: ROLE_LABELS[admin.role_name] ?? 'admin', invitedBy: ctx.admin.name ?? 'A PigMaster admin', token,
  });
  return { email: admin.email, email_sent: emailSent, expires_in_hours: LINK_HOURS };
};
