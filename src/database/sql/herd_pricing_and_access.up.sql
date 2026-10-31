-- ============================================================
-- Catch-up for databases created before these features were added to the initial schema.
-- Safe to run any number of times: everything is "IF NOT EXISTS" / "ON CONFLICT DO NOTHING".
-- Runs as a normal migration: npm run migrate
-- ============================================================

-- ============================================================
-- USER CONSENTS (append-only evidence of what each person agreed to)
--
-- One row per decision: accepting the privacy policy/terms at sign-up, opting in to or
-- withdrawing from marketing. The latest row per (user, consent_type) is the current state.
-- Rows are never updated, so the history can be shown to the user or a regulator.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_consents (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type VARCHAR(30)  NOT NULL CHECK (consent_type IN ('privacy_policy', 'terms', 'marketing')),
  granted      BOOLEAN      NOT NULL,
  -- Version (date) of the document the person saw.
  version      VARCHAR(20)  NOT NULL,
  source       VARCHAR(30)  NOT NULL CHECK (source IN ('registration', 'google_sign_in', 'settings', 'team_invite', 'admin')),
  ip_address   INET,
  user_agent   TEXT,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user ON user_consents (user_id, consent_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_consents_created ON user_consents (created_at DESC);



-- ============================================================
-- ADMIN ROLES (who may do what in the admin dashboard)
--
-- permissions holds "<object>.<operation>" keys generated from the admin object configs
-- (e.g. "customers.read", "payments.export", "admins.create"), wildcards allowed.
-- Users with an admin_role_id are staff; everyone else is a farmer.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_roles (
  id          SERIAL       PRIMARY KEY,
  key         VARCHAR(50)  NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  permissions JSONB        NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(permissions) = 'array'),
  -- System roles cannot be deleted; the super role always has full access.
  is_system   BOOLEAN      NOT NULL DEFAULT false,
  is_super    BOOLEAN      NOT NULL DEFAULT false,
  sort_order  INTEGER      NOT NULL DEFAULT 100,
  is_active   INTEGER      DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_deleted  INTEGER      DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO admin_roles (key, name, description, permissions, is_system, is_super, sort_order)
VALUES
  ('super_admin', 'Super admin', 'Full access to everything, including admins and roles.', '["*"]'::JSONB, true, true, 1),
  ('read_only_admin', 'Read-only admin', 'Sees every screen and can export, but cannot add, change or delete anything.',
    '["*.read", "*.export"]'::JSONB, true, false, 2),
  ('support', 'Support', 'Helps farmers: views customers, farms and activity and can suspend or reactivate accounts.',
    '["dashboard.read", "customers.read", "customers.update", "farms.read", "payments.read", "activity_logs.read"]'::JSONB, true, false, 3),
  ('finance', 'Finance', 'Payments, plans and revenue reports.',
    '["dashboard.read", "payments.read", "payments.export", "plans.read", "customers.read"]'::JSONB, true, false, 4),
  ('partner', 'Partner', 'Anonymised platform analytics only.', '["dashboard.read"]'::JSONB, true, false, 5)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role_id INTEGER REFERENCES admin_roles(id);
CREATE INDEX IF NOT EXISTS idx_users_admin_role ON users (admin_role_id) WHERE admin_role_id IS NOT NULL;



-- Existing admins keep their access: superadmin -> Super admin, partner -> Partner.
UPDATE users u SET admin_role_id = ar.id
FROM roles r, admin_roles ar
WHERE r.id = u.role_id AND u.admin_role_id IS NULL
  AND ((r.name = 'superadmin' AND ar.key = 'super_admin') OR (r.name = 'partner' AND ar.key = 'partner'));

-- ============================================================
-- SUBSCRIPTION NOTICES (trial / plan ending reminders)
--
-- One row per subscription and stage, so each reminder email is sent at most once
-- even with several API instances or restarts. Stages are relative to the end date (UTC).
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_notices (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            VARCHAR(10) NOT NULL CHECK (kind IN ('trial', 'plan')),
  stage           VARCHAR(20) NOT NULL CHECK (stage IN ('before_5', 'before_2', 'before_1', 'ended', 'after_3')),
  ends_at         TIMESTAMP WITH TIME ZONE NOT NULL,
  email_status    VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed')),
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (subscription_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_subscription_notices_user ON subscription_notices (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_end ON subscriptions (trial_end_date) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry ON subscriptions (expiry_date) WHERE is_active = 1;



-- Herd-size pricing columns.
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS included_pigs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS price_per_extra_pig NUMERIC(10,4) NOT NULL DEFAULT 0;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_price NUMERIC(10,2);
-- Kenya herd-size prices, applied only to plans still on the original $1 / $2 launch prices.
UPDATE subscription_plans SET price = 390, currency = 'KES', included_pigs = 50, price_per_extra_pig = 4, max_price = 15000
WHERE name = 'standard' AND currency = 'USD' AND price = 1;
UPDATE subscription_plans SET price = 650, currency = 'KES', included_pigs = 100, price_per_extra_pig = 5, max_price = 20000
WHERE name = 'advanced' AND currency = 'USD' AND price = 2;

-- Veterinarian and accountant are not offered to farm admins for now (existing holders keep access).
UPDATE farm_roles SET assignable = false WHERE key IN ('veterinarian', 'accountant') AND assignable;
