CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  permissions JSONB DEFAULT '[]'::JSONB,
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0,1)),
  is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO roles (name, description, permissions, is_active, is_deleted)
VALUES
  ('free', 'Free tier - Basic access', '["basic_records", "view_reports"]'::JSONB, 1, 0),
  ('standard', 'Standard tier - Enhanced features', '["analytics", "exports", "multi_user"]'::JSONB, 1, 0),
  ('advanced', 'Advanced tier - Full access', '["unlimited_pigs", "sms_alerts", "integrations", "automation"]'::JSONB, 1, 0),
  ('admin', 'Admin role - Full farm management', '["all"]'::JSONB, 1, 0),
  ('superadmin', 'SuperAdmin role - System-wide control', '["all", "manage_roles"]'::JSONB, 1, 0)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255),
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  avatar_url VARCHAR(500),
  role_id INTEGER REFERENCES roles(id),
  provider VARCHAR(50) DEFAULT 'local',
  provider_id VARCHAR(255),
  email_verified BOOLEAN DEFAULT false,
  phone_verified BOOLEAN DEFAULT false,
  last_login TIMESTAMP WITH TIME ZONE,
  login_count INTEGER DEFAULT 0,
  preferences JSONB DEFAULT '{}'::JSONB,
  subscription_start TIMESTAMP WITH TIME ZONE,
  subscription_end TIMESTAMP WITH TIME ZONE,
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0,1)),
  is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  location VARCHAR(255),
  latitude DECIMAL(9,2),
  longitude DECIMAL(9,2),
  size DECIMAL(10,2),
  description TEXT,
  timezone VARCHAR(255) DEFAULT 'UTC',
  breeds JSONB DEFAULT '[]'::JSONB,
  colors JSONB DEFAULT '[]'::JSONB,
  currency VARCHAR(3) DEFAULT 'USD',
  settings JSONB DEFAULT '{}'::JSONB,
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS farm_id UUID REFERENCES farms(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS password_resets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT false,
  is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS token_blacklist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL UNIQUE,
  duration_months INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  description TEXT,
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES subscription_plans(id) ON DELETE SET NULL,
  current_plan VARCHAR(50) NOT NULL DEFAULT 'trial',
  status VARCHAR(20) NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','expired','cancelled','pending_payment')),
  trial_start_date TIMESTAMP WITH TIME ZONE,
  trial_end_date TIMESTAMP WITH TIME ZONE,
  start_date TIMESTAMP WITH TIME ZONE,
  expiry_date TIMESTAMP WITH TIME ZONE,
  payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','cancelled','expired')),
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  farm_id UUID REFERENCES farms(id) ON DELETE SET NULL,
  plan VARCHAR(50) NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  payment_mode VARCHAR(50) NOT NULL DEFAULT 'mpesa',
  phone_number VARCHAR(20),
  transaction_id VARCHAR(255),
  merchant_request_id VARCHAR(255),
  checkout_request_id VARCHAR(255),
  mpesa_receipt_number VARCHAR(100),
  callback_payload JSONB DEFAULT '{}'::JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','cancelled')),
  metadata JSONB DEFAULT '{}'::JSONB,
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0,1)),
  is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0,1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payments_checkout_request_id ON payments(checkout_request_id);
