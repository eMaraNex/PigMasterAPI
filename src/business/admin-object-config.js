import Joi from 'joi';
import { schema } from './base.js';
import { SOFT_DELETE } from './object-config.js';

/*
 * Platform-admin objects, mounted at /api/v1/admin/<path>. They are not tenant
 * scoped; access is limited by `adminRoles` and every call is written to
 * admin_audit_logs by the engine.
 */
const SUPER_ADMIN = ['SUPER_ADMIN'];
const NOT_STAFF = "(SELECT id FROM roles WHERE name IN ('superadmin', 'partner'))";

export const adminObjectConfigs = {
  customers: {
    path: 'customers',
    table: 'users',
    alias: 'u',
    label: 'Customer',
    adminRoles: SUPER_ADMIN,
    softDelete: SOFT_DELETE,
    baseWhere: alias => `${alias}.role_id NOT IN ${NOT_STAFF}`,
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
        { field: 'created_at', header: 'Joined' },
      ],
    },
  },

  farms: {
    path: 'farms',
    table: 'farms',
    alias: 'f',
    label: 'Farm',
    adminRoles: SUPER_ADMIN,
    softDelete: SOFT_DELETE,
    operations: ['list', 'get', 'export'],
    defaultSort: { field: 'created_at', order: 'DESC' },
    columns: {
      name: { searchable: true },
      location: { searchable: true },
      size: { type: 'number' },
      currency: {},
      created_at: { type: 'datetime' },
      pig_count: {
        type: 'integer',
        sortable: false,
        sql: '(SELECT COUNT(*)::int FROM pigs fp WHERE fp.farm_id = f.id AND fp.is_deleted = 0)',
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
  },

  payments: {
    path: 'payments',
    table: 'payments',
    alias: 'pay',
    label: 'Payment',
    adminRoles: SUPER_ADMIN,
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
    adminRoles: SUPER_ADMIN,
    operations: ['list', 'get', 'create', 'update', 'export'],
    defaultSort: { field: 'price', order: 'ASC' },
    messages: { duplicate: 'A plan with this name already exists' },
    columns: {
      name: { searchable: true },
      duration_months: { type: 'integer' },
      price: { type: 'number' },
      currency: {},
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
        description: schema.text(500).allow('', null),
        is_active: Joi.boolean().default(true),
      }),
      update: Joi.object({
        duration_months: Joi.number().integer().min(1).max(36),
        price: schema.money(),
        currency: Joi.string().valid('USD', 'KES'),
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

  audit_logs: {
    path: 'audit-logs',
    table: 'admin_audit_logs',
    alias: 'aal',
    label: 'Audit entry',
    adminRoles: SUPER_ADMIN,
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
    adminRoles: SUPER_ADMIN,
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
