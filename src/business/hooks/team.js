import Joi from 'joi';
import { clientBaseUrl } from '../../config/urls.js';
import { randomBytes } from 'crypto';
import { DatabaseHelper } from '../../config/database.js';
import { ForbiddenError, ValidationError } from '../../middleware/errors.js';
import logger from '../../middleware/logger.js';
import EmailService from '../../services/email.services.js';
import { ConflictError } from '../helpers.js';

// Team seats per plan, the owner included. Trials get the full allowance.
const SEATS = { free: 1, standard: 3, advanced: null };
const INVITE_LINK_HOURS = 72;

const inviteSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().max(255).required(),
  name: Joi.string().trim().min(2).max(100).required(),
  phone: Joi.string().trim().pattern(/^\+?[0-9 ]{7,20}$/).allow('', null),
  farm_role_id: Joi.number().integer().positive().required(),
});

const assertManageable = (ctx, member) => {
  if (member.user_id === ctx.farmAccess?.ownerId) throw new ForbiddenError('The farm owner cannot be changed or removed');
  if (member.user_id === ctx.user.id) throw new ForbiddenError('You cannot change your own access');
};

const assignableRole = async (client, roleId) => {
  const { rows } = await client.query(
    `SELECT id, name FROM farm_roles
     WHERE id = $1 AND assignable AND NOT is_owner_role AND is_active = 1 AND is_deleted = 0`,
    [roleId]
  );
  if (!rows.length) throw new ValidationError('Choose a valid role');
  return rows[0];
};

/** Plan that applies to the farm: the owner's active paid plan, else trial or free. */
const farmPlan = async (client, ctx) => {
  const { rows } = await client.query(
    `SELECT s.current_plan FROM subscriptions s
     WHERE s.user_id = $1 AND s.is_active = 1 AND s.status = 'active' AND s.expiry_date > CURRENT_TIMESTAMP
     ORDER BY s.expiry_date DESC LIMIT 1`,
    [ctx.farmAccess.ownerId]
  );
  if (rows.length) return rows[0].current_plan;
  return ctx.farmAccess.accessControl.isTrialActive ? 'advanced' : 'free';
};

export const teamHooks = {
  async beforeUpdate(ctx, member, data) {
    assertManageable(ctx, member);
    if (data.farm_role_id !== undefined) await assignableRole(ctx.client, data.farm_role_id);
  },
  async beforeDelete(ctx, member) {
    assertManageable(ctx, member);
    return 'hard';
  },
  async afterDelete(ctx, member) {
    // A removed member whose active farm was this one moves to another farm they can open.
    await ctx.client.query(
      `UPDATE users SET farm_id = (
         SELECT f.id FROM farms f
         LEFT JOIN farm_members m ON m.farm_id = f.id AND m.user_id = $2 AND m.status = 'active'
         WHERE f.is_deleted = 0 AND (f.created_by = $2 OR m.id IS NOT NULL)
         ORDER BY f.created_at LIMIT 1)
       WHERE id = $2 AND farm_id = $1`,
      [member.farm_id, member.user_id]
    );
  },
};

/** Roles a farm admin can hand out, with what each one allows. */
export const assignableRoles = async () => {
  const { rows } = await DatabaseHelper.executeQuery(
    `SELECT id, key, name, description, permissions FROM farm_roles
     WHERE assignable AND NOT is_owner_role AND is_active = 1 AND is_deleted = 0
     ORDER BY sort_order, name`
  );
  return rows;
};


const sendInviteEmail = async ({ email, name, farmName, invitedBy, roleName, setupToken }) => {
  const url = setupToken ? `${clientBaseUrl()}/reset-password/${setupToken}` : `${clientBaseUrl()}/login`;
  const action = setupToken ? `Set your password to get started (link valid for ${INVITE_LINK_HOURS} hours)` : 'Sign in to open the farm';
  const text = `Hi ${name},\n\n${invitedBy} added you to ${farmName} on PigMaster as ${roleName}.\n${action}: ${url}\n`;
  const result = await new EmailService({}, logger).sendEmail({
    to: email,
    subject: `You have been added to ${farmName} on PigMaster`,
    text,
    appName: 'PigMaster',
  }, 'team_invite');
  return Boolean(result?.success);
};

/**
 * Adds a person to the farm with a role. New people get an account and a
 * set-password link by email; existing users simply gain access to the farm.
 */
export const inviteMember = async (ctx, service, body) => {
  const { error, value } = inviteSchema.validate(body ?? {}, { abortEarly: false, stripUnknown: true });
  if (error) throw new ValidationError(`Validation error: ${error.details.map(detail => detail.message).join(', ')}`);

  const result = await DatabaseHelper.withTransaction(async client => {
    const role = await assignableRole(client, value.farm_role_id);
    const plan = await farmPlan(client, ctx);
    const seats = Object.hasOwn(SEATS, plan) ? SEATS[plan] : SEATS.free;
    if (seats !== null) {
      const { rows } = await client.query('SELECT COUNT(*)::int AS members FROM farm_members WHERE farm_id = $1', [ctx.farmId]);
      if (rows[0].members >= seats) {
        throw new ForbiddenError(`Your ${plan} plan allows ${seats} team member${seats === 1 ? '' : 's'}. Upgrade to add more people.`);
      }
    }

    const existing = await client.query('SELECT id, name FROM users WHERE lower(email) = $1 AND is_deleted = 0', [value.email]);
    let userId = existing.rows[0]?.id;
    let setupToken = null;
    if (!userId) {
      const created = await client.query(
        `INSERT INTO users (email, name, phone, role_id, provider, email_verified, farm_id)
         VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name = 'free'), 'local', false, $4) RETURNING id`,
        [value.email, value.name, value.phone || null, ctx.farmId]
      );
      userId = created.rows[0].id;
      setupToken = randomBytes(32).toString('hex');
      await client.query(
        `INSERT INTO password_resets (user_id, token, expires_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP + make_interval(hours => $3))`,
        [userId, setupToken, INVITE_LINK_HOURS]
      );
    }

    const member = await client.query(
      `INSERT INTO farm_members (farm_id, user_id, farm_role_id, status, invited_by, joined_at)
       VALUES ($1, $2, $3, 'active', $4, CURRENT_TIMESTAMP)
       ON CONFLICT (farm_id, user_id) DO NOTHING RETURNING id`,
      [ctx.farmId, userId, role.id, ctx.user.id]
    );
    if (!member.rows.length) throw new ConflictError(`${value.email} is already on this farm's team`);
    await client.query('UPDATE users SET farm_id = $1 WHERE id = $2 AND farm_id IS NULL', [ctx.farmId, userId]);
    await client.query(
      `INSERT INTO activity_logs (user_id, farm_id, action, entity_type, entity_id, new_values)
       VALUES ($1, $2, 'invite', 'team', $3, $4::jsonb)`,
      [ctx.user.id, ctx.farmId, member.rows[0].id, JSON.stringify({ email: value.email, role: role.name })]
    );
    return { memberId: member.rows[0].id, roleName: role.name, setupToken };
  });

  let emailSent = false;
  try {
    emailSent = await sendInviteEmail({
      email: value.email,
      name: value.name,
      farmName: ctx.farmAccess.farmName,
      invitedBy: ctx.user.name,
      roleName: result.roleName,
      setupToken: result.setupToken,
    });
  } catch (mailError) {
    logger.warn(`Team invite email to ${value.email} failed: ${mailError.message}`);
  }
  return { ...(await service.getById(ctx, result.memberId)), email_sent: emailSent, new_account: Boolean(result.setupToken) };
};

/** Makes another farm the user can access their active farm. */
export const switchFarm = async (ctx, farmId) => {
  const { rows } = await DatabaseHelper.executeQuery(
    `UPDATE users u SET farm_id = f.id
     FROM farms f
     WHERE u.id = $2 AND f.id = $1 AND f.is_deleted = 0
       AND (f.created_by = $2 OR EXISTS (
         SELECT 1 FROM farm_members m WHERE m.farm_id = f.id AND m.user_id = $2 AND m.status = 'active'))
     RETURNING f.id, f.name`,
    [farmId, ctx.user.id]
  );
  if (!rows.length) throw new ForbiddenError('You do not have access to this farm');
  return rows[0];
};

/**
 * Sends a fresh set-password link to a team member who never finished their invite
 * (for example because the link expired). Older unused links stop working.
 */
export const resendInvite = async (ctx, service, memberId) => {
  const member = await service.getById(ctx, memberId);
  if (member.password_set) throw new ValidationError(`${member.name} has already set a password; they can sign in or use "Forgot password"`);
  if (member.status !== 'active') throw new ValidationError('Re-enable this member before resending the invite');

  const setupToken = randomBytes(32).toString('hex');
  await DatabaseHelper.withTransaction(async client => {
    await client.query('UPDATE password_resets SET used = true WHERE user_id = $1 AND used = false', [member.user_id]);
    await client.query(
      `INSERT INTO password_resets (user_id, token, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + make_interval(hours => $3))`,
      [member.user_id, setupToken, INVITE_LINK_HOURS]
    );
    await client.query(
      `INSERT INTO activity_logs (user_id, farm_id, action, entity_type, entity_id, new_values)
       VALUES ($1, $2, 'resend_invite', 'team', $3, $4::jsonb)`,
      [ctx.user.id, ctx.farmId, member.id, JSON.stringify({ email: member.email })]
    );
  });

  let emailSent = false;
  try {
    emailSent = await sendInviteEmail({
      email: member.email,
      name: member.name,
      farmName: ctx.farmAccess.farmName,
      invitedBy: ctx.user.name,
      roleName: member.role_name,
      setupToken,
    });
  } catch (mailError) {
    logger.warn(`Resending invite to ${member.email} failed: ${mailError.message}`);
  }
  return { email: member.email, email_sent: emailSent, expires_in_hours: INVITE_LINK_HOURS };
};
