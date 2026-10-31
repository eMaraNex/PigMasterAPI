import Joi from 'joi';
import { schema } from './base.js';
import { DatabaseHelper } from '../config/database.js';
import { ValidationError } from '../middleware/errors.js';
import { SOFT_DELETE, farmObjectConfigs } from './object-config.js';
import { buildPermissionCatalog, sanitisePermissions } from './permissions.js';
import { adminUserHooks, inviteAdmin, resendAdminInvite } from './hooks/admins.js';

/*
 * Platform-admin objects, mounted at /api/v1/admin/<path>. They are not tenant
 * scoped; access is limited by the caller's admin role permissions and every call is written to
 * admin_audit_logs by the engine.
 */
// Staff accounts carry an admin role; everyone else is a farmer.
const IS_FARMER = alias => `${alias}.admin_role_id IS NULL`;
const PERMISSION_KEY = Joi.string().max(100).pattern(/^(\*|(\*|[a-z_]+)\.(\*|read|create|update|delete|export))$/);
const permissionCatalog = () => buildPermissionCatalog(farmObjectConfigs);

/** Everything support staff need about one farm: owner, plan, herd, team, money and activity. */
const farmProfile = async id => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new ValidationError('Invalid farm id');
  const q = (sql, params = [id]) => DatabaseHelper.executeQuery(sql, params).then(result => result.rows);
  const [farm] = await q(
    `SELECT f.id, f.name, f.location, f.latitude::float AS lat, f.longitude::float AS lng, f.size, f.currency, f.timezone,
            f.description, f.created_at, f.is_active,
            o.id AS owner_id, o.name AS owner_name, o.email AS owner_email, o.phone AS owner_phone, o.last_login AS owner_last_login,
            o.created_at AS owner_joined, o.subscription_end,
            (SELECT s.current_plan FROM subscriptions s WHERE s.user_id = o.id AND s.is_active = 1 ORDER BY s.created_at DESC LIMIT 1) AS plan,
            (SELECT s.status FROM subscriptions s WHERE s.user_id = o.id AND s.is_active = 1 ORDER BY s.created_at DESC LIMIT 1) AS plan_status
     FROM farms f LEFT JOIN users o ON o.id = f.created_by
     WHERE f.id = $1 AND f.is_deleted = 0`
  );
  if (!farm) throw new ValidationError('Farm not found');
  const [herd, team, payments, activity, monthly] = await Promise.all([
    q(`SELECT
         (SELECT COUNT(*)::int FROM pigs WHERE farm_id = $1 AND is_deleted = 0) AS pigs,
         (SELECT COUNT(*)::int FROM pigs WHERE farm_id = $1 AND is_deleted = 0 AND gender = 'female') AS females,
         (SELECT COUNT(*)::int FROM pigs WHERE farm_id = $1 AND is_deleted = 0 AND gender = 'male') AS males,
         (SELECT COUNT(*)::int FROM pigs WHERE farm_id = $1 AND is_deleted = 0 AND is_pregnant) AS pregnant,
         (SELECT COUNT(*)::int FROM rows WHERE farm_id = $1 AND is_deleted = 0) AS rows,
         (SELECT COUNT(*)::int FROM pens WHERE farm_id = $1 AND is_deleted = 0) AS pens,
         (SELECT COUNT(*)::int FROM pens WHERE farm_id = $1 AND is_deleted = 0 AND is_occupied) AS occupied_pens,
         (SELECT COALESCE(SUM(number_of_piglets), 0)::int FROM breeding_records WHERE farm_id = $1 AND is_deleted = 0 AND actual_birth_date > CURRENT_DATE - 365) AS piglets_12m,
         (SELECT COUNT(*)::int FROM removal_records WHERE farm_id = $1 AND is_deleted = 0 AND reason = 'sale' AND date > CURRENT_DATE - 365) AS sold_12m,
         (SELECT COUNT(*)::int FROM removal_records WHERE farm_id = $1 AND is_deleted = 0 AND reason LIKE 'death%' AND date > CURRENT_DATE - 365) AS deaths_12m,
         (SELECT COALESCE(SUM(amount), 0)::float FROM earnings_records WHERE farm_id = $1 AND is_deleted = 0 AND date > CURRENT_DATE - 365) AS income_12m,
         (SELECT COUNT(*)::int FROM health_records WHERE farm_id = $1 AND is_deleted = 0 AND date > CURRENT_DATE - 365) AS health_12m,
         (SELECT MAX(created_at) FROM activity_logs WHERE farm_id = $1) AS last_activity`),
    q(`SELECT m.id, u.name, u.email, fr.name AS role, m.status, m.joined_at, u.last_login, (f.created_by = u.id) AS is_owner
       FROM farm_members m JOIN users u ON u.id = m.user_id JOIN farm_roles fr ON fr.id = m.farm_role_id JOIN farms f ON f.id = m.farm_id
       WHERE m.farm_id = $1 ORDER BY (f.created_by = u.id) DESC, m.joined_at`),
    q(`SELECT id, plan, amount::float, currency, status, mpesa_receipt_number, created_at
       FROM payments WHERE user_id = $1 AND is_deleted = 0 ORDER BY created_at DESC LIMIT 10`, [farm.owner_id]),
    q(`SELECT a.action, a.entity_type, a.created_at, u.name AS user_name
       FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.farm_id = $1 AND a.is_deleted = 0 ORDER BY a.created_at DESC LIMIT 15`),
    q(`SELECT to_char(m, 'YYYY-MM') AS month,
              COALESCE((SELECT SUM(amount)::float FROM earnings_records e WHERE e.farm_id = $1 AND e.is_deleted = 0 AND date_trunc('month', e.date) = m), 0) AS income,
              (SELECT COUNT(*)::int FROM health_records h WHERE h.farm_id = $1 AND h.is_deleted = 0 AND date_trunc('month', h.date) = m) AS health
       FROM generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '11 months', date_trunc('month', CURRENT_DATE), INTERVAL '1 month') AS m
       ORDER BY m`),
  ]);
  return { farm, herd: herd[0], team, payments, activity, monthly };
};

/** Farm locations for the admin map, plus how many farms have no coordinates yet. */
const farmMap = async () => {
  const { rows } = await DatabaseHelper.executeQuery(
    `SELECT f.id, f.name, f.location, f.latitude::float AS lat, f.longitude::float AS lng, f.created_at,
            o.name AS owner_name, o.email AS owner_email,
            (SELECT COUNT(*)::int FROM pigs p WHERE p.farm_id = f.id AND p.is_deleted = 0) AS pigs
     FROM farms f LEFT JOIN users o ON o.id = f.created_by
     WHERE f.is_deleted = 0 AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL
     ORDER BY f.created_at DESC
     LIMIT 20000`
  );
  const { rows: totals } = await DatabaseHelper.executeQuery(
    'SELECT COUNT(*)::int AS farms, COUNT(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL)::int AS unmapped FROM farms WHERE is_deleted = 0'
  );
  return { points: rows, ...totals[0] };
};

export const adminObjectConfigs = {
  customers: {
    path: 'customers',
    table: 'users',
    alias: 'u',
    label: 'Customer',
    softDelete: SOFT_DELETE,
    baseWhere: IS_FARMER,
    operations: ['list', 'get', 'update', 'export'],
    defaultSort: { field: 'created_at', order: 'DESC' },
    hiddenFields: ['password_hash', 'admin_mfa_secret', 'preferences', 'provider_id'],
    columns: {
      name: { searchable: true },
      email: { searchable: true },
      phone: { searchable: true },
      is_active: { type: 'flag' },
      email_verified: { type: 'boolean' },
      provider: {},
      last_login: { type: 'datetime' },
      subscription_end: { type: 'datetime' },
      created_at: { type: 'datetime' },
      farm_count: {
        type: 'integer',
        sortable: false,
        sql: '(SELECT COUNT(*)::int FROM farms cf WHERE cf.created_by = u.id AND cf.is_deleted = 0)',
      },
      pig_count: {
        type: 'integer',
        sortable: false,
        sql: `(SELECT COUNT(*)::int FROM pigs cp JOIN farms cf ON cf.id = cp.farm_id
               WHERE cf.created_by = u.id AND cf.is_deleted = 0 AND cp.is_deleted = 0)`,
      },
      privacy_accepted_at: {
        type: 'datetime',
        sortable: false,
        sql: `(SELECT MAX(c.created_at) FROM user_consents c
               WHERE c.user_id = u.id AND c.consent_type = 'privacy_policy' AND c.granted)`,
      },
      marketing_consent: {
        type: 'boolean',
        sortable: false,
        sql: `COALESCE((SELECT c.granted FROM user_consents c WHERE c.user_id = u.id AND c.consent_type = 'marketing'
               ORDER BY c.created_at DESC LIMIT 1), false)`,
      },
      subscription_status: {
        sortable: false,
        sql: `COALESCE((SELECT s.status FROM subscriptions s WHERE s.user_id = u.id AND s.is_active = 1
               ORDER BY s.created_at DESC LIMIT 1), 'none')`,
      },
    },
    joins: [
      { table: 'roles', alias: 'cr', on: 'cr.id = u.role_id', columns: { plan: 'cr.name' } },
    ],
    schemas: {
      // Admins can suspend or reactivate an account; profile data stays owned by the farmer.
      update: Joi.object({ is_active: Joi.boolean().required() }),
    },
    export: {
      columns: [
        { field: 'name', header: 'Name' },
        { field: 'email', header: 'Email' },
        { field: 'phone', header: 'Phone' },
        { field: 'plan', header: 'Plan' },
        { field: 'subscription_status', header: 'Subscription' },
        { field: 'farm_count', header: 'Farms' },
        { field: 'pig_count', header: 'Pigs' },
        { field: 'last_login', header: 'Last login' },
        { field: 'privacy_accepted_at', header: 'Privacy policy accepted' },
        { field: 'marketing_consent', header: 'Marketing consent' },
        { field: 'created_at', header: 'Joined' },
      ],
    },
  },

  farms: {
    path: 'farms',
    table: 'farms',
    alias: 'f',
    label: 'Farm',
    softDelete: SOFT_DELETE,
    operations: ['list', 'get', 'export'],
    defaultSort: { field: 'created_at', order: 'DESC' },
    columns: {
      name: { searchable: true },
      location: { searchable: true },
      latitude: { type: 'number' },
      longitude: { type: 'number' },
      size: { type: 'number' },
      currency: {},
      created_at: { type: 'datetime' },
      pig_count: {
        type: 'integer',
        sortable: false,
        sql: '(SELECT COUNT(*)::int FROM pigs fp WHERE fp.farm_id = f.id AND fp.is_deleted = 0)',
      },
      team_size: {
        type: 'integer',
        sortable: false,
        sql: '(SELECT COUNT(*)::int FROM farm_members fm WHERE fm.farm_id = f.id AND fm.status = \'active\')',
      },
      pen_count: {
        type: 'integer',
        sortable: false,
        sql: '(SELECT COUNT(*)::int FROM pens fpn WHERE fpn.farm_id = f.id AND fpn.is_deleted = 0)',
      },
    },
    joins: [
      {
        table: 'users',
        alias: 'o',
        on: 'o.id = f.created_by',
        columns: { owner_name: { sql: 'o.name', searchable: true }, owner_email: { sql: 'o.email', searchable: true } },
      },
    ],
    actions: [
      { method: 'get', path: '/map', handler: () => farmMap() },
      { method: 'get', path: '/profile/:id', handler: (ctx, req) => farmProfile(req.params.id) },
    ],
  },

  // Roles farm admins can give their team. Only platform admins define what each role may do.
  farm_roles: {
    path: 'farm-roles',
    table: 'farm_roles',
    alias: 'frl',
    label: 'Farm role',
    idType: 'integer',
    softDelete: SOFT_DELETE,
    defaultSort: { field: 'sort_order', order: 'ASC' },
    messages: { duplicate: 'A role with this key already exists' },
    columns: {
      key: { searchable: true },
      name: { searchable: true },
      description: { searchable: true },
      permissions: { type: 'json', sortable: false, filterable: false },
      is_system: { type: 'boolean', writable: false },
      is_owner_role: { type: 'boolean', writable: false },
      assignable: { type: 'boolean' },
      sort_order: { type: 'integer' },
      is_active: { type: 'flag' },
      created_at: { type: 'datetime' },
      updated_at: { type: 'datetime' },
      member_count: {
        type: 'integer',
        sortable: false,
        sql: '(SELECT COUNT(*)::int FROM farm_members m WHERE m.farm_role_id = frl.id)',
      },
    },
    schemas: {
      create: Joi.object({
        key: Joi.string().trim().lowercase().pattern(/^[a-z][a-z0-9_]{1,49}$/).required(),
        name: schema.text(100).min(2).required(),
        description: schema.text(500).allow('', null),
        permissions: Joi.array().items(PERMISSION_KEY).max(500).default([]),
        assignable: Joi.boolean().default(true),
        sort_order: Joi.number().integer().min(0).max(1000).default(100),
        is_active: Joi.boolean().default(true),
      }),
      update: Joi.object({
        name: schema.text(100).min(2),
        description: schema.text(500).allow('', null),
        permissions: Joi.array().items(PERMISSION_KEY).max(500),
        assignable: Joi.boolean(),
        sort_order: Joi.number().integer().min(0).max(1000),
        is_active: Joi.boolean(),
      }).min(1),
    },
    hooks: {
      async beforeCreate(ctx, data) {
        data.permissions = sanitisePermissions(data.permissions, permissionCatalog());
      },
      async beforeUpdate(ctx, role, data) {
        if (role.is_owner_role) {
          // The farm admin role always keeps full access and stays usable.
          if (data.permissions !== undefined || data.is_active === false || data.assignable === true) {
            throw new ValidationError('The farm admin role always has full access; only its name and description can change');
          }
        }
        if (data.permissions !== undefined) data.permissions = sanitisePermissions(data.permissions, permissionCatalog());
        data.updated_at = new Date();
      },
      async beforeDelete(ctx, role) {
        if (role.is_system) throw new ValidationError('Built-in roles cannot be deleted; deactivate them instead');
        const { rows } = await ctx.client.query('SELECT COUNT(*)::int AS members FROM farm_members WHERE farm_role_id = $1', [role.id]);
        if (rows[0].members) throw new ValidationError(`${rows[0].members} team members still have this role`);
        return 'soft';
      },
    },
    actions: [{ method: 'get', path: '/catalog', handler: () => permissionCatalog() }],
  },

  payments: {
    path: 'payments',
    table: 'payments',
    alias: 'pay',
    label: 'Payment',
    softDelete: SOFT_DELETE,
    operations: ['list', 'get', 'export'],
    defaultSort: { field: 'created_at', order: 'DESC' },
    hiddenFields: ['callback_token', 'callback_payload', 'idempotency_key'],
    columns: {
      plan: {},
      amount: { type: 'number' },
      currency: {},
      payment_mode: {},
      phone_number: { searchable: true },
      status: {},
      mpesa_receipt_number: { searchable: true },
      checkout_request_id: { searchable: true },
      failure_reason: {},
      status_checks: { type: 'integer' },
      completed_at: { type: 'datetime' },
      created_at: { type: 'datetime' },
    },
    joins: [
      {
        table: 'users',
        alias: 'pu',
        on: 'pu.id = pay.user_id',
        columns: { customer_name: { sql: 'pu.name', searchable: true }, customer_email: { sql: 'pu.email', searchable: true } },
      },
    ],
  },

  plans: {
    path: 'plans',
    table: 'subscription_plans',
    alias: 'sp',
    label: 'Plan',
    operations: ['list', 'get', 'create', 'update', 'export'],
    defaultSort: { field: 'price', order: 'ASC' },
    messages: { duplicate: 'A plan with this name already exists' },
    columns: {
      name: { searchable: true },
      duration_months: { type: 'integer' },
      price: { type: 'number' },
      currency: {},
      included_pigs: { type: 'integer' },
      price_per_extra_pig: { type: 'number' },
      max_price: { type: 'number' },
      description: { searchable: true },
      is_active: { type: 'flag' },
      created_at: { type: 'datetime' },
      active_subscribers: {
        type: 'integer',
        sortable: false,
        sql: `(SELECT COUNT(*)::int FROM subscriptions s
               WHERE s.plan_id = sp.id AND s.status = 'active' AND s.is_active = 1)`,
      },
    },
    schemas: {
      create: Joi.object({
        name: Joi.string().trim().lowercase().pattern(/^[a-z][a-z0-9_]{1,49}$/).required(),
        duration_months: Joi.number().integer().min(1).max(36).required(),
        price: schema.money().required(),
        currency: Joi.string().valid('USD', 'KES').required(),
        included_pigs: Joi.number().integer().min(0).max(1000000).default(0),
        price_per_extra_pig: Joi.number().min(0).max(1000).precision(4).default(0),
        max_price: schema.money().allow(null),
        description: schema.text(500).allow('', null),
        is_active: Joi.boolean().default(true),
      }),
      update: Joi.object({
        duration_months: Joi.number().integer().min(1).max(36),
        price: schema.money(),
        currency: Joi.string().valid('USD', 'KES'),
        included_pigs: Joi.number().integer().min(0).max(1000000),
        price_per_extra_pig: Joi.number().min(0).max(1000).precision(4),
        max_price: schema.money().allow(null),
        description: schema.text(500).allow('', null),
        is_active: Joi.boolean(),
      }).min(1),
    },
    hooks: {
      // A paid plan grants the role of the same name, so make sure that role exists.
      async afterCreate(ctx, plan) {
        await ctx.client.query(
          `INSERT INTO roles (name, description, permissions) VALUES ($1, $2, '[]'::jsonb)
           ON CONFLICT (name) DO NOTHING`,
          [plan.name, `${plan.name} subscription tier`]
        );
      },
    },
  },

  // People who can sign in to this dashboard. Super admins manage everything; partners see analytics only.
  admins: {
    path: 'admins',
    table: 'users',
    alias: 'adm',
    label: 'Admin',
    softDelete: SOFT_DELETE,
    baseWhere: alias => `${alias}.admin_role_id IS NOT NULL`,
    operations: ['list', 'get', 'update', 'export'],
    defaultSort: { field: 'created_at', order: 'ASC' },
    hiddenFields: ['password_hash', 'admin_mfa_secret', 'preferences', 'provider_id'],
    columns: {
      name: { searchable: true },
      email: { searchable: true },
      phone: {},
      admin_role_id: { type: 'integer' },
      is_active: { type: 'flag' },
      last_login: { type: 'datetime' },
      created_at: { type: 'datetime' },
      password_set: { type: 'boolean', sortable: false, filterable: false, sql: '(adm.password_hash IS NOT NULL)' },
    },
    joins: [
      {
        table: 'admin_roles', alias: 'admr', on: 'admr.id = adm.admin_role_id',
        columns: { role_name: 'admr.name', is_super: { sql: 'admr.is_super', type: 'boolean' } },
      },
    ],
    schemas: {
      update: Joi.object({
        admin_role_id: Joi.number().integer().positive(),
        is_active: Joi.boolean(),
      }).min(1),
    },
    hooks: adminUserHooks,
    actions: [
      { method: 'post', path: '/invite', handler: (ctx, req) => inviteAdmin(ctx, req.body) },
      { method: 'post', path: '/resend-invite/:id', handler: (ctx, req, service) => resendAdminInvite(ctx, service, req.params.id) },
    ],
    export: {
      columns: [
        { field: 'name', header: 'Name' },
        { field: 'email', header: 'Email' },
        { field: 'role_name', header: 'Role' },
        { field: 'is_active', header: 'Active' },
        { field: 'last_login', header: 'Last sign-in' },
        { field: 'created_at', header: 'Added' },
      ],
    },
  },

  // What each admin role may do in this dashboard; toggled per area and operation.
  admin_roles: {
    path: 'admin-roles',
    table: 'admin_roles',
    alias: 'ar',
    label: 'Admin role',
    idType: 'integer',
    softDelete: SOFT_DELETE,
    defaultSort: { field: 'sort_order', order: 'ASC' },
    messages: { duplicate: 'A role with this key already exists' },
    columns: {
      key: { searchable: true },
      name: { searchable: true },
      description: { searchable: true },
      permissions: { type: 'json', sortable: false, filterable: false },
      is_system: { type: 'boolean', writable: false },
      is_super: { type: 'boolean', writable: false },
      sort_order: { type: 'integer' },
      is_active: { type: 'flag' },
      created_at: { type: 'datetime' },
      updated_at: { type: 'datetime' },
      member_count: {
        type: 'integer',
        sortable: false,
        sql: '(SELECT COUNT(*)::int FROM users u WHERE u.admin_role_id = ar.id AND u.is_deleted = 0)',
      },
    },
    schemas: {
      create: Joi.object({
        key: Joi.string().trim().lowercase().pattern(/^[a-z][a-z0-9_]{1,49}$/).required(),
        name: schema.text(100).min(2).required(),
        description: schema.text(500).allow('', null),
        permissions: Joi.array().items(PERMISSION_KEY).max(500).default([]),
        sort_order: Joi.number().integer().min(0).max(1000).default(100),
        is_active: Joi.boolean().default(true),
      }),
      update: Joi.object({
        name: schema.text(100).min(2),
        description: schema.text(500).allow('', null),
        permissions: Joi.array().items(PERMISSION_KEY).max(500),
        sort_order: Joi.number().integer().min(0).max(1000),
        is_active: Joi.boolean(),
      }).min(1),
    },
    hooks: {
      async beforeCreate(ctx, data) {
        data.permissions = sanitisePermissions(data.permissions, adminPermissionCatalog());
      },
      async beforeUpdate(ctx, role, data) {
        if (role.is_super && (data.permissions !== undefined || data.is_active === false)) {
          throw new ValidationError('The super admin role always has full access; only its name and description can change');
        }
        if (role.id === ctx.admin.admin_role_id && (data.permissions !== undefined || data.is_active === false)) {
          throw new ValidationError('You cannot change the permissions of your own role');
        }
        if (data.permissions !== undefined) data.permissions = sanitisePermissions(data.permissions, adminPermissionCatalog());
        data.updated_at = new Date();
      },
      async beforeDelete(ctx, role) {
        if (role.is_system) throw new ValidationError('Built-in roles cannot be deleted; deactivate them instead');
        const { rows } = await ctx.client.query('SELECT COUNT(*)::int AS n FROM users WHERE admin_role_id = $1 AND is_deleted = 0', [role.id]);
        if (rows[0].n) throw new ValidationError(`${rows[0].n} admins still have this role`);
        return 'soft';
      },
    },
    actions: [{ method: 'get', path: '/catalog', handler: () => adminPermissionCatalog() }],
  },

  // Append-only record of privacy/terms acceptance and marketing opt-ins/outs.
  consents: {
    path: 'consents',
    table: 'user_consents',
    alias: 'uc',
    label: 'Consent',
    operations: ['list', 'get', 'export'],
    audit: false,
    defaultSort: { field: 'created_at', order: 'DESC' },
    hiddenFields: ['user_agent'],
    columns: {
      consent_type: {},
      granted: { type: 'boolean' },
      version: {},
      source: {},
      ip_address: { sortable: false },
      user_agent: { sortable: false, filterable: false },
      created_at: { type: 'datetime' },
    },
    joins: [
      {
        table: 'users', alias: 'cu', on: 'cu.id = uc.user_id',
        columns: { user_name: { sql: 'cu.name', searchable: true }, user_email: { sql: 'cu.email', searchable: true } },
      },
    ],
    export: {
      columns: [
        { field: 'user_name', header: 'Name' },
        { field: 'user_email', header: 'Email' },
        { field: 'consent_type', header: 'Consent' },
        { field: 'granted', header: 'Granted' },
        { field: 'version', header: 'Policy version' },
        { field: 'source', header: 'Where' },
        { field: 'ip_address', header: 'IP address' },
        { field: 'created_at', header: 'When' },
      ],
    },
  },

  audit_logs: {
    path: 'audit-logs',
    table: 'admin_audit_logs',
    alias: 'aal',
    label: 'Audit entry',
    operations: ['list', 'get', 'export'],
    audit: false,
    defaultSort: { field: 'created_at', order: 'DESC' },
    columns: {
      action: { searchable: true },
      ip_address: { sortable: false },
      filters: { type: 'json', sortable: false, filterable: false },
      created_at: { type: 'datetime' },
    },
    joins: [
      { table: 'users', alias: 'au', on: 'au.id = aal.actor_user_id', columns: { actor: { sql: 'au.email', searchable: true } } },
    ],
  },

  activity_logs: {
    path: 'activity-logs',
    table: 'activity_logs',
    alias: 'al',
    label: 'Activity',
    softDelete: SOFT_DELETE,
    operations: ['list', 'get', 'export'],
    audit: false,
    hiddenFields: ['user_agent'],
    defaultSort: { field: 'created_at', order: 'DESC' },
    columns: {
      action: {},
      entity_type: { searchable: true },
      entity_id: { searchable: true },
      new_values: { type: 'json', sortable: false, filterable: false },
      created_at: { type: 'datetime' },
    },
    joins: [
      { table: 'users', alias: 'acu', on: 'acu.id = al.user_id', columns: { user_email: { sql: 'acu.email', searchable: true } } },
      { table: 'farms', alias: 'acf', on: 'acf.id = al.farm_id', columns: { farm_name: { sql: 'acf.name', searchable: true } } },
    ],
  },
};

// Areas of the admin dashboard as shown in the admin permission editor.
const ADMIN_GROUPS = [
  ['Overview', ['dashboard']],
  ['Customers & farms', ['customers', 'farms', 'farm_roles']],
  ['Money', ['payments', 'plans']],
  ['Admin access', ['admins', 'admin_roles']],
  ['Compliance & logs', ['consents', 'audit_logs', 'activity_logs']],
];

let adminCatalog;
/** Admin permission catalog, built once from the configs above. */
export const adminPermissionCatalog = () => (adminCatalog ??= buildPermissionCatalog(adminObjectConfigs, {
  include: () => true,
  groups: ADMIN_GROUPS,
  extra: { dashboard: { label: 'Overview dashboard', permissionLabel: 'Overview dashboard', permissionOperations: ['read'] } },
}));
