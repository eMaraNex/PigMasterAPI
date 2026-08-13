-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50)  NOT NULL UNIQUE,
  description TEXT,
  permissions JSONB        DEFAULT '[]'::JSONB,
  is_active   INTEGER      DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_deleted  INTEGER      DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO roles (name, description, permissions, is_active, is_deleted)
VALUES
  ('free',       'Free tier - Basic access',              '["basic_records", "view_reports"]'::JSONB,                              1, 0),
  ('standard',   'Standard tier - Enhanced features',     '["analytics", "exports", "multi_user"]'::JSONB,                        1, 0),
  ('advanced',   'Advanced tier - Full access',           '["unlimited_pigs", "sms_alerts", "integrations", "automation"]'::JSONB, 1, 0),
  ('admin',      'Admin role - Full farm management',     '["all"]'::JSONB,                                                        1, 0),
  ('superadmin', 'SuperAdmin role - System-wide control', '["all", "manage_roles"]'::JSONB,                                        1, 0)
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  email               VARCHAR(255) NOT NULL UNIQUE,
  password_hash       VARCHAR(255),
  name                VARCHAR(100) NOT NULL,
  phone               VARCHAR(20),
  avatar_url          VARCHAR(500),
  role_id             INTEGER      REFERENCES roles(id),
  provider            VARCHAR(50)  DEFAULT 'local',
  provider_id         VARCHAR(255),
  email_verified      BOOLEAN      DEFAULT false,
  phone_verified      BOOLEAN      DEFAULT false,
  last_login          TIMESTAMP WITH TIME ZONE,
  login_count         INTEGER      DEFAULT 0,
  preferences         JSONB        DEFAULT '{}'::JSONB,
  subscription_start  TIMESTAMP WITH TIME ZONE,
  subscription_end    TIMESTAMP WITH TIME ZONE,
  is_active           INTEGER      DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_deleted          INTEGER      DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- FARMS
-- ============================================================
CREATE TABLE IF NOT EXISTS farms (
  id          UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255)   NOT NULL UNIQUE,
  location    VARCHAR(255),
  latitude    DECIMAL(9, 2),
  longitude   DECIMAL(9, 2),
  size        DECIMAL(10, 2),
  description TEXT,
  timezone    VARCHAR(255)   DEFAULT 'UTC',
  breeds      JSONB          DEFAULT '[]'::JSONB,
  colors      JSONB          DEFAULT '[]'::JSONB,
  currency    VARCHAR(3)     DEFAULT 'USD',
  settings    JSONB          DEFAULT '{}'::JSONB,
  is_active   INTEGER        DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by  UUID           REFERENCES users(id) ON DELETE SET NULL,
  is_deleted  INTEGER        DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS farm_id UUID REFERENCES farms(id) ON DELETE SET NULL;


-- ============================================================
-- PASSWORD RESETS
-- ============================================================
CREATE TABLE IF NOT EXISTS password_resets (
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID         REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used       BOOLEAN      DEFAULT false,
  is_deleted INTEGER      DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- TOKEN BLACKLIST
-- ============================================================
CREATE TABLE IF NOT EXISTS token_blacklist (
  id         UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  token      TEXT    NOT NULL,
  user_id    UUID    REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- SUBSCRIPTION PLANS
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             VARCHAR(50)   NOT NULL UNIQUE,
  duration_months  INTEGER       NOT NULL DEFAULT 1,
  price            NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency         VARCHAR(3)    NOT NULL DEFAULT 'USD',
  description      TEXT,
  is_active        INTEGER       DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id          UUID        REFERENCES subscription_plans(id) ON DELETE SET NULL,
  current_plan     VARCHAR(50) NOT NULL DEFAULT 'trial',
  status           VARCHAR(20) NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','expired','cancelled','pending_payment')),
  trial_start_date TIMESTAMP WITH TIME ZONE,
  trial_end_date   TIMESTAMP WITH TIME ZONE,
  start_date       TIMESTAMP WITH TIME ZONE,
  expiry_date      TIMESTAMP WITH TIME ZONE,
  payment_status   VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','cancelled','expired')),
  is_active        INTEGER     DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- ROWS
-- ============================================================
CREATE TABLE IF NOT EXISTS rows (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(50)  NOT NULL,
  farm_id     UUID         NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  description TEXT,
  levels      TEXT[]       NOT NULL DEFAULT ARRAY['A', 'B', 'C']::TEXT[],
  capacity    INTEGER      NOT NULL DEFAULT 18 CHECK (capacity BETWEEN 1 AND 200),
  occupied    INTEGER      DEFAULT 0 CHECK (occupied >= 0 AND occupied <= capacity),
  is_deleted  INTEGER      DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (farm_id, name)
);


-- ============================================================
-- PENS
-- ============================================================
CREATE TABLE IF NOT EXISTS pens (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(50) NOT NULL,
  row_id       UUID        REFERENCES rows(id) ON DELETE CASCADE,
  farm_id      UUID        NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  level        VARCHAR(1)  NOT NULL CHECK (level ~ '^[A-Z]$'),
  position     INTEGER     NOT NULL CHECK (position BETWEEN 1 AND 50),
  size         VARCHAR(20) NOT NULL DEFAULT 'medium',
  material     VARCHAR(20) NOT NULL DEFAULT 'wire',
  features     JSONB       DEFAULT '["water bottle", "feeder"]',
  is_occupied  BOOLEAN     DEFAULT false,
  last_cleaned TIMESTAMP WITH TIME ZONE,
  is_deleted   INTEGER     DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (farm_id, name),
  UNIQUE (row_id, level, position)
);


-- ============================================================
-- PIGS
-- ============================================================
CREATE TABLE IF NOT EXISTS pigs (
  id                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id             UUID           NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  pig_id              VARCHAR(200)   NOT NULL UNIQUE,
  name                VARCHAR(50),
  gender              VARCHAR(6)     NOT NULL CHECK (gender IN ('male', 'female')),
  breed               VARCHAR(50)    NOT NULL,
  color               VARCHAR(50)    NOT NULL,
  birth_date          DATE           NOT NULL,
  weight              DECIMAL(5, 2)  NOT NULL CHECK (weight > 0),
  pen_id              UUID           REFERENCES pens(id),
  parent_male_id      VARCHAR(200)   REFERENCES pigs(pig_id),
  parent_female_id    VARCHAR(200)   REFERENCES pigs(pig_id),
  acquisition_type    VARCHAR(20)    DEFAULT 'birth',
  acquisition_date    DATE,
  acquisition_cost    DECIMAL(10, 2) CHECK (acquisition_cost >= 0),
  is_pregnant         BOOLEAN        DEFAULT false,
  pregnancy_start_date DATE,
  expected_birth_date DATE,
  actual_birth_date   DATE,
  total_litters       INTEGER        DEFAULT 0 CHECK (total_litters >= 0),
  total_piglets       INTEGER        DEFAULT 0 CHECK (total_piglets >= 0),
  status              VARCHAR(20)    DEFAULT 'active',
  notes               TEXT,
  is_deleted          INTEGER        DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- PEN PIG HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS pen_pig_history (
  id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  pen_id          UUID           REFERENCES pens(id) ON DELETE CASCADE,
  pig_id          VARCHAR(200)   REFERENCES pigs(pig_id) ON DELETE CASCADE,
  farm_id         UUID           NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  assigned_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at      TIMESTAMP WITH TIME ZONE,
  removal_reason  VARCHAR(100),
  removal_notes   TEXT,
  sale_amount     DECIMAL(10, 2) CHECK (sale_amount >= 0),
  sale_date       DATE,
  sale_weight     DECIMAL(5, 2)  CHECK (sale_weight > 0),
  sold_to         VARCHAR(100),
  is_deleted      INTEGER        DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- BREEDING RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS breeding_records (
  id                  UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id             UUID    NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  sow_id              VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
  boar_id             VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
  mating_date         DATE    NOT NULL,
  expected_birth_date DATE,
  actual_birth_date   DATE,
  number_of_piglets   INTEGER CHECK (number_of_piglets >= 0),
  notes               TEXT,
  alert_date          DATE,
  is_deleted          INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- PIGLET RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS piglet_records (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  breeding_record_id  UUID          NOT NULL REFERENCES breeding_records(id) ON DELETE CASCADE,
  farm_id             UUID          NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  piglet_number       VARCHAR(50)   NOT NULL,
  birth_weight        DECIMAL(5, 2) CHECK (birth_weight > 0),
  gender              VARCHAR(6)    CHECK (gender IN ('male', 'female')),
  color               VARCHAR(50),
  status              VARCHAR(20)   DEFAULT 'alive',
  weaning_date        DATE,
  weaning_weight      DECIMAL(5, 2) CHECK (weaning_weight > 0),
  parent_male_id      VARCHAR(200)  REFERENCES pigs(pig_id) ON DELETE CASCADE,
  parent_female_id    VARCHAR(200)  REFERENCES pigs(pig_id) ON DELETE CASCADE,
  notes               TEXT,
  is_deleted          INTEGER       DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- BREEDING CALENDAR
-- ============================================================
CREATE TABLE IF NOT EXISTS breeding_calendar (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id      UUID         NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  sow_id       VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
  boar_id      VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
  planned_date DATE         NOT NULL,
  status       VARCHAR(20)  DEFAULT 'planned',
  notes        TEXT,
  is_deleted   INTEGER      DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- HEALTH RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS health_records (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  pig_id       VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
  type         VARCHAR(20)  NOT NULL CHECK (type IN ('vaccination', 'treatment', 'checkup', 'medication', 'surgery', 'other')),
  description  TEXT         NOT NULL,
  date         DATE         NOT NULL,
  next_due     DATE,
  status       VARCHAR(20)  DEFAULT 'completed',
  veterinarian VARCHAR(100),
  notes        TEXT,
  is_deleted   INTEGER      DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- HEALTH ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS health_alerts (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id     UUID        NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  pig_id      VARCHAR(200) REFERENCES pigs(pig_id) ON DELETE CASCADE,
  alert_type  VARCHAR(50)  NOT NULL,
  severity    VARCHAR(20)  DEFAULT 'medium',
  message     TEXT         NOT NULL,
  is_read     BOOLEAN      DEFAULT false,
  is_resolved BOOLEAN      DEFAULT false,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID         REFERENCES users(id),
  is_deleted  INTEGER      DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- VACCINATION SCHEDULES
-- ============================================================
CREATE TABLE IF NOT EXISTS vaccination_schedules (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id         UUID        NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  vaccine_name    VARCHAR(100) NOT NULL,
  description     TEXT,
  frequency_days  INTEGER     NOT NULL CHECK (frequency_days > 0),
  age_start_days  INTEGER     DEFAULT 0 CHECK (age_start_days >= 0),
  is_active       INTEGER     DEFAULT 0 CHECK (is_active IN (0, 1)),
  is_deleted      INTEGER     DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- FEEDING SCHEDULES
-- ============================================================
CREATE TABLE IF NOT EXISTS feeding_schedules (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  pig_id       VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
  daily_amount VARCHAR(50)  NOT NULL,
  feed_type    VARCHAR(50)  NOT NULL,
  times        JSONB        NOT NULL,
  special_diet TEXT,
  last_fed     TIMESTAMP WITH TIME ZONE,
  is_active    INTEGER      DEFAULT 0 CHECK (is_active IN (0, 1)),
  is_deleted   INTEGER      DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- FEEDING RECORDS (unified: daily, weekly, monthly)
-- ============================================================
CREATE TABLE IF NOT EXISTS feeding_records (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  pig_id       VARCHAR(200)  REFERENCES pigs(pig_id) ON DELETE CASCADE,
  pen_id       UUID          REFERENCES pens(id),
  farm_id      UUID          NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  feed_type    VARCHAR(50)   NOT NULL,
  amount       VARCHAR(50)   NOT NULL,
  unit         VARCHAR(20)   DEFAULT 'grams',
  feeding_time TIMESTAMP WITH TIME ZONE NOT NULL,
  fed_by       UUID          REFERENCES users(id),
  notes        TEXT,
  record_type  VARCHAR(20)   DEFAULT 'daily' CHECK (record_type IN ('daily', 'weekly', 'monthly')),
  start_date   DATE,
  end_date     DATE,
  total_amount NUMERIC(12, 3),
  pigs_in_pen  JSONB         DEFAULT '[]',
  pigs_count   INTEGER       DEFAULT 0,
  is_deleted   INTEGER       DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- FEED INVENTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS feed_inventory (
  id             UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id        UUID           NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  feed_type      VARCHAR(50)    NOT NULL,
  brand          VARCHAR(50),
  quantity       DECIMAL(10, 2) NOT NULL CHECK (quantity >= 0),
  unit           VARCHAR(20)    NOT NULL,
  cost_per_unit  DECIMAL(10, 2) CHECK (cost_per_unit >= 0),
  purchase_date  DATE,
  expiry_date    DATE,
  supplier       VARCHAR(100),
  notes          TEXT,
  is_deleted     INTEGER        DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- EARNINGS RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS earnings_records (
  id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id         UUID           NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  type            VARCHAR(20)    NOT NULL,
  pig_id          VARCHAR(200)   REFERENCES pigs(pig_id),
  amount          DECIMAL(12, 2) NOT NULL CHECK (amount >= 0),
  currency        VARCHAR(3)     DEFAULT 'USD',
  date            DATE           NOT NULL,
  weight          DECIMAL(8, 2)  CHECK (weight > 0),
  sale_type       VARCHAR(20)    NOT NULL,
  includes_urine  BOOLEAN        DEFAULT false,
  includes_manure BOOLEAN        DEFAULT false,
  buyer_name      VARCHAR(100),
  notes           TEXT,
  pen_id          UUID           REFERENCES pens(id),
  is_deleted      INTEGER        DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- PRODUCTION RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS production_records (
  id         UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id    UUID           NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  type       VARCHAR(20)    NOT NULL,
  quantity   DECIMAL(10, 2) NOT NULL CHECK (quantity >= 0),
  unit       VARCHAR(20)    NOT NULL,
  date       DATE           NOT NULL,
  source     VARCHAR(50),
  notes      TEXT,
  is_deleted INTEGER        DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- REMOVAL RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS removal_records (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  pig_id      VARCHAR(200)  NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
  pen_id      UUID          REFERENCES pens(id),
  farm_id     UUID          NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  reason      VARCHAR(100)  NOT NULL CHECK (reason IN (
    'sale',
    'death - natural',
    'death - disease',
    'death - accident',
    'transfer to another farm',
    'breeding loan',
    'retirement',
    'health issues',
    'other',
    'transfer to another pen',
    'lost',
    'stolen'
  )),
  notes       TEXT,
  date        DATE          NOT NULL,
  sale_amount DECIMAL(10,2) CHECK (sale_amount >= 0),
  sale_weight DECIMAL(5, 2) CHECK (sale_weight > 0),
  sold_to     VARCHAR(100),
  is_deleted  INTEGER       DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- EXPENSES
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id             UUID           NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  category            VARCHAR(50)    NOT NULL,
  description         TEXT           NOT NULL,
  amount              DECIMAL(12, 2) NOT NULL CHECK (amount >= 0),
  currency            VARCHAR(3)     DEFAULT 'USD',
  date                DATE           NOT NULL,
  vendor              VARCHAR(100),
  payment_method      VARCHAR(20),
  receipt_url         VARCHAR(500),
  is_recurring        BOOLEAN        DEFAULT false,
  recurring_frequency VARCHAR(20),
  notes               TEXT,
  is_deleted          INTEGER        DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,
  title      VARCHAR(200) NOT NULL,
  message    TEXT        NOT NULL,
  data       JSONB       DEFAULT '{}',
  is_read    BOOLEAN     DEFAULT false,
  read_at    TIMESTAMP WITH TIME ZONE,
  priority   VARCHAR(20) DEFAULT 'medium',
  expires_at TIMESTAMP WITH TIME ZONE,
  is_deleted INTEGER     DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- ACTIVITY LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        REFERENCES users(id),
  farm_id     UUID        REFERENCES farms(id),
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id   VARCHAR(50),
  old_values  JSONB,
  new_values  JSONB,
  ip_address  INET,
  user_agent  TEXT,
  is_deleted  INTEGER     DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- SYSTEM SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         VARCHAR(100) NOT NULL UNIQUE,
  value       JSONB       NOT NULL,
  description TEXT,
  is_public   BOOLEAN     DEFAULT false,
  is_deleted  INTEGER     DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- FILE UPLOADS
-- ============================================================
CREATE TABLE IF NOT EXISTS file_uploads (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        REFERENCES users(id),
  farm_id       UUID        REFERENCES farms(id),
  filename      VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size          INTEGER     NOT NULL CHECK (size > 0),
  path          VARCHAR(500) NOT NULL,
  entity_type   VARCHAR(50),
  entity_id     VARCHAR(50),
  is_public     BOOLEAN     DEFAULT false,
  is_deleted    INTEGER     DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- PIG BIRTH HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS pig_birth_history (
  id                 UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id            UUID    NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  sow_id             VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
  breeding_record_id UUID    REFERENCES breeding_records(id) ON DELETE SET NULL,
  birth_date         DATE    NOT NULL,
  number_of_piglets  INTEGER NOT NULL CHECK (number_of_piglets >= 0),
  notes              TEXT,
  is_deleted         INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             VARCHAR(255) NOT NULL,
  alert_start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  alert_end_date   TIMESTAMP WITH TIME ZONE,
  alert_type       VARCHAR(50)  NOT NULL,
  severity         VARCHAR(20)  NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  message          TEXT         NOT NULL,
  status           VARCHAR(20)  NOT NULL CHECK (status IN ('pending', 'sent', 'completed', 'rejected')),
  farm_id          UUID         NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  user_id          UUID         REFERENCES users(id) ON DELETE SET NULL,
  pig_id           VARCHAR(200) REFERENCES pigs(pig_id) ON DELETE SET NULL,
  pen_id           UUID         REFERENCES pens(id) ON DELETE SET NULL,
  notify_on        DATE[]       NOT NULL DEFAULT '{}',
  created_on       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_on       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_active        BOOLEAN      DEFAULT true,
  is_deleted       BOOLEAN      DEFAULT false
);


-- ============================================================
-- EMAIL LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS email_logs (
  id         UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID    REFERENCES users(id) ON DELETE SET NULL,
  farm_id    UUID    REFERENCES farms(id) ON DELETE SET NULL,
  count      INTEGER NOT NULL CHECK (count = 1),
  date       DATE    NOT NULL,
  is_active  INTEGER DEFAULT 0 CHECK (is_active IN (0, 1)),
  is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id                   UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  farm_id              UUID           REFERENCES farms(id) ON DELETE SET NULL,
  plan                 VARCHAR(50)    NOT NULL,
  amount               NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  currency             VARCHAR(3)     NOT NULL DEFAULT 'USD',
  payment_mode         VARCHAR(50)    NOT NULL DEFAULT 'mpesa',
  phone_number         VARCHAR(20),
  transaction_id       VARCHAR(255),
  merchant_request_id  VARCHAR(255),
  checkout_request_id  VARCHAR(255),
  mpesa_receipt_number VARCHAR(100),
  callback_payload     JSONB          DEFAULT '{}'::JSONB,
  status               VARCHAR(20)    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'cancelled')),
  metadata             JSONB          DEFAULT '{}'::JSONB,
  is_active            INTEGER        DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_deleted           INTEGER        DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- PIG TRANSFER HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS pig_transfer_history (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id         UUID         NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  pig_id          VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
  old_pen_id      UUID         REFERENCES pens(id) ON DELETE SET NULL,
  new_pen_id      UUID         NOT NULL REFERENCES pens(id) ON DELETE RESTRICT,
  transfer_reason VARCHAR(100) NOT NULL CHECK (transfer_reason IN (
    'quarantine',
    'cannibalism_prevention',
    'breeding_program',
    'overcrowding',
    'facility_maintenance',
    'social_grouping',
    'other'
  )),
  transfer_notes  TEXT,
  transferred_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  transferred_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_deleted      INTEGER      DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TRIGGER FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

CREATE OR REPLACE FUNCTION update_updated_on_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_on = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

CREATE OR REPLACE FUNCTION update_row_occupied()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF NEW.row_id IS NOT NULL THEN
      UPDATE rows
      SET occupied = (
        SELECT COUNT(*) FROM pens
        WHERE row_id = NEW.row_id AND is_occupied = true AND is_deleted = 0
      )
      WHERE id = NEW.row_id AND is_deleted = 0;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.row_id IS NOT NULL THEN
      UPDATE rows
      SET occupied = (
        SELECT COUNT(*) FROM pens
        WHERE row_id = OLD.row_id AND is_occupied = true AND is_deleted = 0
      )
      WHERE id = OLD.row_id AND is_deleted = 0;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE 'plpgsql';

CREATE OR REPLACE FUNCTION update_pig_birth_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE pigs
  SET
    total_litters = (
      SELECT COUNT(*) FROM pig_birth_history
      WHERE sow_id = NEW.sow_id AND farm_id = NEW.farm_id AND is_deleted = 0
    ),
    total_piglets = (
      SELECT COALESCE(SUM(number_of_piglets), 0) FROM pig_birth_history
      WHERE sow_id = NEW.sow_id AND farm_id = NEW.farm_id AND is_deleted = 0
    ),
    updated_at = CURRENT_TIMESTAMP
  WHERE pig_id = NEW.sow_id AND farm_id = NEW.farm_id AND is_deleted = 0;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at              BEFORE UPDATE ON users              FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_farms_updated_at ON farms;
CREATE TRIGGER update_farms_updated_at              BEFORE UPDATE ON farms              FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rows_updated_at ON rows;
CREATE TRIGGER update_rows_updated_at               BEFORE UPDATE ON rows               FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pens_updated_at ON pens;
CREATE TRIGGER update_pens_updated_at               BEFORE UPDATE ON pens               FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pigs_updated_at ON pigs;
CREATE TRIGGER update_pigs_updated_at               BEFORE UPDATE ON pigs               FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pen_pig_history_updated_at ON pen_pig_history;
CREATE TRIGGER update_pen_pig_history_updated_at    BEFORE UPDATE ON pen_pig_history    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_breeding_records_updated_at ON breeding_records;
CREATE TRIGGER update_breeding_records_updated_at   BEFORE UPDATE ON breeding_records   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_piglet_records_updated_at ON piglet_records;
CREATE TRIGGER update_piglet_records_updated_at     BEFORE UPDATE ON piglet_records     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_health_records_updated_at ON health_records;
CREATE TRIGGER update_health_records_updated_at     BEFORE UPDATE ON health_records     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_feeding_schedules_updated_at ON feeding_schedules;
CREATE TRIGGER update_feeding_schedules_updated_at  BEFORE UPDATE ON feeding_schedules  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_feeding_records_updated_at ON feeding_records;
CREATE TRIGGER update_feeding_records_updated_at    BEFORE UPDATE ON feeding_records    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_feed_inventory_updated_at ON feed_inventory;
CREATE TRIGGER update_feed_inventory_updated_at     BEFORE UPDATE ON feed_inventory     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_earnings_records_updated_at ON earnings_records;
CREATE TRIGGER update_earnings_records_updated_at   BEFORE UPDATE ON earnings_records   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_production_records_updated_at ON production_records;
CREATE TRIGGER update_production_records_updated_at BEFORE UPDATE ON production_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_expenses_updated_at ON expenses;
CREATE TRIGGER update_expenses_updated_at           BEFORE UPDATE ON expenses           FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_health_alerts_updated_at ON health_alerts;
CREATE TRIGGER update_health_alerts_updated_at      BEFORE UPDATE ON health_alerts      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_vaccination_schedules_updated_at ON vaccination_schedules;
CREATE TRIGGER update_vaccination_schedules_updated_at BEFORE UPDATE ON vaccination_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_system_settings_updated_at ON system_settings;
CREATE TRIGGER update_system_settings_updated_at    BEFORE UPDATE ON system_settings    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pig_birth_history_updated_at ON pig_birth_history;
CREATE TRIGGER update_pig_birth_history_updated_at  BEFORE UPDATE ON pig_birth_history  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_email_logs_updated_at ON email_logs;
CREATE TRIGGER update_email_logs_updated_at         BEFORE UPDATE ON email_logs         FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
CREATE TRIGGER update_payments_updated_at           BEFORE UPDATE ON payments           FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pig_transfer_history_updated_at ON pig_transfer_history;
CREATE TRIGGER update_pig_transfer_history_updated_at BEFORE UPDATE ON pig_transfer_history FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscription_plans_updated_at ON subscription_plans;
CREATE TRIGGER update_subscription_plans_updated_at BEFORE UPDATE ON subscription_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at      BEFORE UPDATE ON subscriptions      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TRIGGERS: alerts updated_on
-- ============================================================
DROP TRIGGER IF EXISTS update_alerts_updated_on ON alerts;
CREATE TRIGGER update_alerts_updated_on
BEFORE UPDATE ON alerts
FOR EACH ROW EXECUTE FUNCTION update_updated_on_column();

-- ============================================================
-- TRIGGERS: row occupied count
-- ============================================================
DROP TRIGGER IF EXISTS update_pens_occupied ON pens;
CREATE TRIGGER update_pens_occupied
AFTER INSERT OR UPDATE OF is_occupied, is_deleted, row_id OR DELETE
ON pens
FOR EACH ROW EXECUTE FUNCTION update_row_occupied();

-- ============================================================
-- TRIGGERS: pig birth stats
-- ============================================================
DROP TRIGGER IF EXISTS update_pig_birth_stats ON pig_birth_history;
CREATE TRIGGER update_pig_birth_stats
AFTER INSERT OR UPDATE OF number_of_piglets, is_deleted
ON pig_birth_history
FOR EACH ROW EXECUTE FUNCTION update_pig_birth_stats();


-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_users_farm_id ON users(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_users_subscription_start ON users(subscription_start) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_users_subscription_end ON users(subscription_end) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_farms_created_by ON farms(created_by) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_rows_farm_id ON rows(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_rows_name ON rows(name) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_pens_row_id ON pens(row_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pens_farm_id ON pens(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pens_name ON pens(name) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pens_is_occupied ON pens(is_occupied) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_pigs_farm_id ON pigs(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pigs_pig_id ON pigs(pig_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pigs_pen_id ON pigs(pen_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pigs_status ON pigs(status) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_pen_pig_history_pen_id ON pen_pig_history(pen_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pen_pig_history_pig_id ON pen_pig_history(pig_id) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_breeding_records_farm_id ON breeding_records(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_breeding_records_sow_id ON breeding_records(sow_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_breeding_records_boar_id ON breeding_records(boar_id) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_piglet_records_breeding_record_id ON piglet_records(breeding_record_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_piglet_records_farm_id ON piglet_records(farm_id) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_health_records_pig_id ON health_records(pig_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_health_records_date ON health_records(date) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_feeding_records_pig_id ON feeding_records(pig_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_feeding_records_pen_id ON feeding_records(pen_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_feeding_records_date ON feeding_records(feeding_time) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_feeding_records_record_type ON feeding_records(record_type) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_feeding_records_farm_id ON feeding_records(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_feeding_records_start_date ON feeding_records(start_date) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_earnings_records_farm_id ON earnings_records(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_earnings_records_date ON earnings_records(date) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_production_records_farm_id ON production_records(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_production_records_date ON production_records(date) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_activity_logs_farm_id ON activity_logs(farm_id) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_pig_birth_history_farm_id ON pig_birth_history(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pig_birth_history_sow_id ON pig_birth_history(sow_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pig_birth_history_breeding_record_id ON pig_birth_history(breeding_record_id) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_alerts_farm_id ON alerts(farm_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_alerts_alert_start_date ON alerts(alert_start_date) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_alerts_is_active ON alerts(is_active) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_alerts_notify_on ON alerts USING GIN (notify_on) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_email_logs_farm_id ON email_logs(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_email_logs_date ON email_logs(date) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_email_logs_is_active ON email_logs(is_active) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_payments_farm_id ON payments(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments(transaction_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_payments_checkout_request_id ON payments(checkout_request_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_pig_transfer_history_farm_id ON pig_transfer_history(farm_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pig_transfer_history_pig_id ON pig_transfer_history(pig_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pig_transfer_history_old_pen_id ON pig_transfer_history(old_pen_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pig_transfer_history_new_pen_id ON pig_transfer_history(new_pen_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pig_transfer_history_transferred_at ON pig_transfer_history(transferred_at) WHERE is_deleted = 0;