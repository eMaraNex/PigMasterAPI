import { pool } from "../config/database.js";
import logger from "../middleware/logger.js";
import dotenv from "dotenv";

dotenv.config();

const migrations = [
  {
    version: 1,
    name: "create_initial_tables",
    up: `
      -- Enable UUID extension
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      -- Create roles table
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        permissions JSONB DEFAULT '[]',
        is_active INTEGER DEFAULT 0 CHECK (is_active IN (0, 1)),
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Insert tier roles if they don't exist
      INSERT INTO roles (name, description, permissions, is_active, is_deleted)
      SELECT 'free', 'Free tier - Basic access', '["basic_records", "view_reports"]'::JSONB, 1, 0
      WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'free');

      INSERT INTO roles (name, description, permissions, is_active, is_deleted)
      SELECT 'standard', 'Standard tier - Enhanced features', '["analytics", "exports", "multi_user"]'::JSONB, 1, 0
      WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'standard');

      INSERT INTO roles (name, description, permissions, is_active, is_deleted)
      SELECT 'advanced', 'Advanced tier - Full access', '["unlimited_pigs", "sms_alerts", "integrations", "automation"]'::JSONB, 1, 0
      WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'advanced');

      INSERT INTO roles (name, description, permissions, is_active, is_deleted)
      SELECT 'admin', 'Admin role - Full farm management', '["all"]'::JSONB, 1, 0
      WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'admin');

      INSERT INTO roles (name, description, permissions, is_active, is_deleted)
      SELECT 'superadmin', 'SuperAdmin role - System-wide control', '["all", "manage_roles"]'::JSONB, 1, 0
      WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'superadmin');

      -- Create users table
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NULL,
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
        preferences JSONB DEFAULT '{}',
        subscription_start TIMESTAMP WITH TIME ZONE,
        subscription_end TIMESTAMP WITH TIME ZONE,
        is_active INTEGER DEFAULT 0 CHECK (is_active IN (0, 1)),
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      -- Add constraint to ensure password_hash is required for local auth
      ALTER TABLE users ADD CONSTRAINT check_password_hash_for_local CHECK (
        (provider = 'local' AND password_hash IS NOT NULL) OR 
        (provider != 'local')
      );
      -- Create farms table
      -- Drop existing farms table if it has incompatible constraints
      DROP TABLE IF EXISTS farms CASCADE;

      -- Create farms table
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
        settings JSONB DEFAULT '{}',
        is_active INTEGER DEFAULT 0 CHECK (is_active IN (0, 1)),
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Add farm_id to users table
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'farm_id') THEN
          ALTER TABLE users ADD COLUMN farm_id UUID REFERENCES farms(id) ON DELETE SET NULL;
        END IF;
      END $$;

      -- Create password_resets table
      CREATE TABLE IF NOT EXISTS password_resets (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used BOOLEAN DEFAULT false,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create token_blacklist table
      CREATE TABLE IF NOT EXISTS token_blacklist (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        token TEXT NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create rows table
      CREATE TABLE IF NOT EXISTS rows (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(50) NOT NULL,
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        description TEXT,
        levels TEXT[] NOT NULL DEFAULT ARRAY['A', 'B', 'C']::TEXT[],
        capacity INTEGER NOT NULL DEFAULT 18 CHECK (capacity BETWEEN 1 AND 200),
        occupied INTEGER DEFAULT 0 CHECK (occupied >= 0 AND occupied <= capacity),
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        -- Unique constraint: row name must be unique within each farm
        UNIQUE(farm_id, name)
      );

      -- Create pens table
      CREATE TABLE IF NOT EXISTS pens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(50) NOT NULL,
        row_id UUID REFERENCES rows(id) ON DELETE CASCADE,
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        level VARCHAR(1) NOT NULL CHECK (level ~ '^[A-Z]$'),
        position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 50),
        size VARCHAR(20) NOT NULL DEFAULT 'medium',
        material VARCHAR(20) NOT NULL DEFAULT 'wire',
        features JSONB DEFAULT '["water bottle", "feeder"]',
        is_occupied BOOLEAN DEFAULT false,
        last_cleaned TIMESTAMP WITH TIME ZONE,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        -- Unique constraint: pen name must be unique within each farm
        UNIQUE(farm_id, name),
        -- Position must be unique within each row
        UNIQUE(row_id, level, position)
      );

      -- Create pigs table
      CREATE TABLE IF NOT EXISTS pigs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        pig_id VARCHAR(200) NOT NULL UNIQUE,
        name VARCHAR(50),
        gender VARCHAR(6) NOT NULL CHECK (gender IN ('male', 'female')),
        breed VARCHAR(50) NOT NULL,
        color VARCHAR(50) NOT NULL,
        birth_date DATE NOT NULL,
        weight DECIMAL(5,2) NOT NULL CHECK (weight > 0),
        pen_id UUID REFERENCES pens(id),
        parent_male_id VARCHAR(200) REFERENCES pigs(pig_id),
        parent_female_id VARCHAR(200) REFERENCES pigs(pig_id),
        acquisition_type VARCHAR(20) DEFAULT 'birth',
        acquisition_date DATE,
        acquisition_cost DECIMAL(10,2) CHECK (acquisition_cost >= 0),
        is_pregnant BOOLEAN DEFAULT false,
        pregnancy_start_date DATE,
        expected_birth_date DATE,
        actual_birth_date DATE,
        total_litters INTEGER DEFAULT 0 CHECK (total_litters >= 0),
        total_piglets INTEGER DEFAULT 0 CHECK (total_piglets >= 0),
        status VARCHAR(20) DEFAULT 'active',
        notes TEXT,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create pen_pig_history table
      CREATE TABLE IF NOT EXISTS pen_pig_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pen_id UUID REFERENCES pens(id) ON DELETE CASCADE,
        pig_id VARCHAR(200) REFERENCES pigs(pig_id) ON DELETE CASCADE,
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        removed_at TIMESTAMP WITH TIME ZONE,
        removal_reason VARCHAR(100),
        removal_notes TEXT,
        sale_amount DECIMAL(10,2) CHECK (sale_amount >= 0),
        sale_date DATE,
        sale_weight DECIMAL(5,2) CHECK (sale_weight > 0),
        sold_to VARCHAR(100),
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Set default role to 'free' for existing users without role_id
      UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'free') 
      WHERE role_id IS NULL AND is_deleted = 0;
    `,
    down: `
      DROP TABLE IF EXISTS pen_pig_history CASCADE;
      DROP TABLE IF EXISTS pigs CASCADE;
      DROP TABLE IF EXISTS pens CASCADE;
      DROP TABLE IF EXISTS rows CASCADE;
      DROP TABLE IF EXISTS token_blacklist CASCADE;
      DROP TABLE IF EXISTS password_resets CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS farms CASCADE;
      -- Delete tier roles (careful: this orphans users with these roles)
      DELETE FROM roles WHERE name IN ('free', 'standard', 'advanced', 'admin', 'superadmin');
      DROP TABLE IF EXISTS roles CASCADE;
    `,
  },
  {
    version: 2,
    name: "create_breeding_tables",
    up: `
      -- Create breeding_records table
      CREATE TABLE IF NOT EXISTS breeding_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        sow_id VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
        boar_id VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
        mating_date DATE NOT NULL,
        expected_birth_date DATE,
        actual_birth_date DATE,
        number_of_piglets INTEGER CHECK (number_of_piglets >= 0),
        notes TEXT,
        alert_date DATE,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create piglet_records table
      CREATE TABLE IF NOT EXISTS piglet_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        breeding_record_id UUID NOT NULL REFERENCES breeding_records(id) ON DELETE CASCADE,
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        piglet_number VARCHAR(50) NOT NULL,
        birth_weight DECIMAL(5,2) CHECK (birth_weight > 0),
        gender VARCHAR(6) CHECK (gender IN ('male', 'female')),
        color VARCHAR(50),
        status VARCHAR(20) DEFAULT 'alive',
        weaning_date DATE,
        weaning_weight DECIMAL(5,2) CHECK (weaning_weight > 0),
        parent_male_id VARCHAR(200) REFERENCES pigs(pig_id) ON DELETE CASCADE,
        parent_female_id VARCHAR(200) REFERENCES pigs(pig_id) ON DELETE CASCADE,
        notes TEXT,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create breeding_calendar table
      CREATE TABLE IF NOT EXISTS breeding_calendar (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        sow_id VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
        boar_id VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
        planned_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'planned',
        notes TEXT,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    down: `
      DROP TABLE IF EXISTS breeding_calendar CASCADE;
      DROP TABLE IF EXISTS piglet_records CASCADE;
      DROP TABLE IF EXISTS breeding_records CASCADE;
    `,
  },
  {
    version: 3,
    name: "create_health_tables",
    up: `
      -- Create health_records table
      CREATE TABLE IF NOT EXISTS health_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pig_id VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL CHECK (type IN ('vaccination', 'treatment', 'checkup', 'medication', 'surgery', 'other')),
        description TEXT NOT NULL,
        date DATE NOT NULL,
        next_due DATE,
        status VARCHAR(20) DEFAULT 'completed',
        veterinarian VARCHAR(100),
        notes TEXT,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create health_alerts table
      CREATE TABLE IF NOT EXISTS health_alerts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        pig_id VARCHAR(200) REFERENCES pigs(pig_id) ON DELETE CASCADE,
        alert_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) DEFAULT 'medium',
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        is_resolved BOOLEAN DEFAULT false,
        resolved_at TIMESTAMP WITH TIME ZONE,
        resolved_by UUID REFERENCES users(id),
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create vaccination_schedules table
      CREATE TABLE IF NOT EXISTS vaccination_schedules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        vaccine_name VARCHAR(100) NOT NULL,
        description TEXT,
        frequency_days INTEGER NOT NULL CHECK (frequency_days > 0),
        age_start_days INTEGER DEFAULT 0 CHECK (age_start_days >= 0),
        is_active INTEGER DEFAULT 0 CHECK (is_active IN (0, 1)),
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    down: `
      DROP TABLE IF EXISTS vaccination_schedules CASCADE;
      DROP TABLE IF EXISTS health_alerts CASCADE;
      DROP TABLE IF EXISTS health_records CASCADE;
    `,
  },
  {
    version: 4,
    name: "create_feeding_tables",
    up: `
      -- Create feeding_schedules table
      CREATE TABLE IF NOT EXISTS feeding_schedules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pig_id VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
        daily_amount VARCHAR(50) NOT NULL,
        feed_type VARCHAR(50) NOT NULL,
        times JSONB NOT NULL,
        special_diet TEXT,
        last_fed TIMESTAMP WITH TIME ZONE,
        is_active INTEGER DEFAULT 0 CHECK (is_active IN (0, 1)),
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create feeding_records table
      CREATE TABLE IF NOT EXISTS feeding_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pig_id VARCHAR(200) REFERENCES pigs(pig_id) ON DELETE CASCADE,
        pen_id UUID REFERENCES pens(id),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        feed_type VARCHAR(50) NOT NULL,
        amount VARCHAR(50) NOT NULL,
        unit VARCHAR(20) DEFAULT 'grams',
        feeding_time TIMESTAMP WITH TIME ZONE NOT NULL,
        fed_by UUID REFERENCES users(id),
        notes TEXT,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create feed_inventory table
      CREATE TABLE IF NOT EXISTS feed_inventory (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        feed_type VARCHAR(50) NOT NULL,
        brand VARCHAR(50),
        quantity DECIMAL(10,2) NOT NULL CHECK (quantity >= 0),
        unit VARCHAR(20) NOT NULL,
        cost_per_unit DECIMAL(10,2) CHECK (cost_per_unit >= 0),
        purchase_date DATE,
        expiry_date DATE,
        supplier VARCHAR(100),
        notes TEXT,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    down: `
      DROP TABLE IF EXISTS feed_inventory CASCADE;
      DROP TABLE IF EXISTS feeding_records CASCADE;
      DROP TABLE IF EXISTS feeding_schedules CASCADE;
    `,
  },
  {
    version: 5,
    name: "create_financial_tables",
    up: `
      -- Create earnings_records table
      CREATE TABLE IF NOT EXISTS earnings_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL,
        pig_id VARCHAR(200) REFERENCES pigs(pig_id),
        amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
        currency VARCHAR(3) DEFAULT 'USD',
        date DATE NOT NULL,
        weight DECIMAL(8,2) CHECK (weight > 0),
        sale_type VARCHAR(20) NOT NULL,
        includes_urine BOOLEAN DEFAULT false,
        includes_manure BOOLEAN DEFAULT false,
        buyer_name VARCHAR(100),
        notes TEXT,
        pen_id UUID REFERENCES pens(id),
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create production_records table
      CREATE TABLE IF NOT EXISTS production_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL,
        quantity DECIMAL(10,2) NOT NULL CHECK (quantity >= 0),
        unit VARCHAR(20) NOT NULL,
        date DATE NOT NULL,
        source VARCHAR(50),
        notes TEXT,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create removal_records table
      CREATE TABLE IF NOT EXISTS removal_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pig_id VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
        pen_id UUID REFERENCES pens(id),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        reason VARCHAR(100) NOT NULL CHECK (reason IN (
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
        notes TEXT,
        date DATE NOT NULL,
        sale_amount DECIMAL(10,2) CHECK (sale_amount >= 0),
        sale_weight DECIMAL(5,2) CHECK (sale_weight > 0),
        sold_to VARCHAR(100),
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create expenses table
      CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        category VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
        currency VARCHAR(3) DEFAULT 'USD',
        date DATE NOT NULL,
        vendor VARCHAR(100),
        payment_method VARCHAR(20),
        receipt_url VARCHAR(500),
        is_recurring BOOLEAN DEFAULT false,
        recurring_frequency VARCHAR(20),
        notes TEXT,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    down: `
      DROP TABLE IF EXISTS expenses CASCADE;
      DROP TABLE IF EXISTS removal_records CASCADE;
      DROP TABLE IF EXISTS production_records CASCADE;
      DROP TABLE IF EXISTS earnings_records CASCADE;
    `,
  },
  {
    version: 6,
    name: "create_system_tables",
    up: `
      -- Create notifications table
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        data JSONB DEFAULT '{}',
        is_read BOOLEAN DEFAULT false,
        read_at TIMESTAMP WITH TIME ZONE,
        priority VARCHAR(20) DEFAULT 'medium',
        expires_at TIMESTAMP WITH TIME ZONE,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create activity_logs table
      CREATE TABLE IF NOT EXISTS activity_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id),
        farm_id UUID REFERENCES farms(id),
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50),
        entity_id VARCHAR(50),
        old_values JSONB,
        new_values JSONB,
        ip_address INET,
        user_agent TEXT,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create system_settings table
      CREATE TABLE IF NOT EXISTS system_settings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        key VARCHAR(100) NOT NULL UNIQUE,
        value JSONB NOT NULL,
        description TEXT,
        is_public BOOLEAN DEFAULT false,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create file_uploads table
      CREATE TABLE IF NOT EXISTS file_uploads (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id),
        farm_id UUID REFERENCES farms(id),
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        size INTEGER NOT NULL CHECK (size > 0),
        path VARCHAR(500) NOT NULL,
        entity_type VARCHAR(50),
        entity_id VARCHAR(50),
        is_public BOOLEAN DEFAULT false,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    down: `
      DROP TABLE IF EXISTS file_uploads CASCADE;
      DROP TABLE IF EXISTS system_settings CASCADE;
      DROP TABLE IF EXISTS activity_logs CASCADE;
      DROP TABLE IF EXISTS notifications CASCADE;
    `,
  },
  {
    version: 7,
    name: "create_indexes_and_triggers",
    up: `
      -- Create performance indexes
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_users_farm_id ON users(farm_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_users_subscription_start ON users(subscription_start) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_users_subscription_end ON users(subscription_end) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_farms_created_by ON farms(created_by) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pigs_farm_id ON pigs(farm_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pigs_pig_id ON pigs(pig_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pigs_pen_id ON pigs(pen_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pigs_status ON pigs(status) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pens_row_id ON pens(row_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pens_farm_id ON pens(farm_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pens_name ON pens(name) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pens_is_occupied ON pens(is_occupied) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_rows_farm_id ON rows(farm_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_rows_name ON rows(name) WHERE is_deleted = 0;
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
      CREATE INDEX IF NOT EXISTS idx_earnings_records_farm_id ON earnings_records(farm_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_earnings_records_date ON earnings_records(date) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_production_records_farm_id ON production_records(farm_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_production_records_date ON production_records(date) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_activity_logs_farm_id ON activity_logs(farm_id) WHERE is_deleted = 0;

      -- Create function to update updated_at timestamp
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';

      -- Create function to update rows.occupied
      CREATE OR REPLACE FUNCTION update_row_occupied()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
          IF NEW.row_id IS NOT NULL THEN
            UPDATE rows
            SET occupied = (
              SELECT COUNT(*)
              FROM pens
              WHERE row_id = NEW.row_id
              AND is_occupied = true
              AND is_deleted = 0
            )
            WHERE id = NEW.row_id
            AND is_deleted = 0;
          END IF;
          RETURN NEW;
        ELSIF TG_OP = 'DELETE' THEN
          IF OLD.row_id IS NOT NULL THEN
            UPDATE rows
            SET occupied = (
              SELECT COUNT(*)
              FROM pens
              WHERE row_id = OLD.row_id
              AND is_occupied = true
              AND is_deleted = 0
            )
            WHERE id = OLD.row_id
            AND is_deleted = 0;
          END IF;
          RETURN OLD;
        END IF;
        RETURN NULL;
      END;
      $$ language 'plpgsql';

      -- Create triggers for updated_at
      CREATE TRIGGER update_farms_updated_at BEFORE UPDATE ON farms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_rows_updated_at BEFORE UPDATE ON rows FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_pens_updated_at BEFORE UPDATE ON pens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_pigs_updated_at BEFORE UPDATE ON pigs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_pen_pig_history_updated_at BEFORE UPDATE ON pen_pig_history FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_breeding_records_updated_at BEFORE UPDATE ON breeding_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_piglet_records_updated_at BEFORE UPDATE ON piglet_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_health_records_updated_at BEFORE UPDATE ON health_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_feeding_schedules_updated_at BEFORE UPDATE ON feeding_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_earnings_records_updated_at BEFORE UPDATE ON earnings_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_production_records_updated_at BEFORE UPDATE ON production_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_feed_inventory_updated_at BEFORE UPDATE ON feed_inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_vaccination_schedules_updated_at BEFORE UPDATE ON vaccination_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER update_health_alerts_updated_at BEFORE UPDATE ON health_alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      -- Create trigger for rows.occupied (handles INSERT/UPDATE/DELETE)
      CREATE TRIGGER update_pens_occupied
      AFTER INSERT OR UPDATE OF is_occupied, is_deleted, row_id OR DELETE
      ON pens
      FOR EACH ROW
      EXECUTE FUNCTION update_row_occupied();
    `,
    down: `
      -- Drop triggers
      DROP TRIGGER IF EXISTS update_farms_updated_at ON farms;
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      DROP TRIGGER IF EXISTS update_rows_updated_at ON rows;
      DROP TRIGGER IF EXISTS update_pens_updated_at ON pens;
      DROP TRIGGER IF EXISTS update_pigs_updated_at ON pigs;
      DROP TRIGGER IF EXISTS update_pen_pig_history_updated_at ON pen_pig_history;
      DROP TRIGGER IF EXISTS update_breeding_records_updated_at ON breeding_records;
      DROP TRIGGER IF EXISTS update_piglet_records_updated_at ON piglet_records;
      DROP TRIGGER IF EXISTS update_health_records_updated_at ON health_records;
      DROP TRIGGER IF EXISTS update_feeding_schedules_updated_at ON feeding_schedules;
      DROP TRIGGER IF EXISTS update_earnings_records_updated_at ON earnings_records;
      DROP TRIGGER IF EXISTS update_production_records_updated_at ON production_records;
      DROP TRIGGER IF EXISTS update_system_settings_updated_at ON system_settings;
      DROP TRIGGER IF EXISTS update_feed_inventory_updated_at ON feed_inventory;
      DROP TRIGGER IF EXISTS update_expenses_updated_at ON expenses;
      DROP TRIGGER IF EXISTS update_vaccination_schedules_updated_at ON vaccination_schedules;
      DROP TRIGGER IF EXISTS update_health_alerts_updated_at ON health_alerts;
      DROP TRIGGER IF EXISTS update_pens_occupied ON pens;

      -- Drop functions
      DROP FUNCTION IF EXISTS update_updated_at_column;
      DROP FUNCTION IF EXISTS update_row_occupied;

      -- Drop indexes
      DROP INDEX IF EXISTS idx_users_email;
      DROP INDEX IF EXISTS idx_users_farm_id;
      DROP INDEX IF EXISTS idx_users_subscription_start;
      DROP INDEX IF EXISTS idx_users_subscription_end;
      DROP INDEX IF EXISTS idx_farms_created_by;
      DROP INDEX IF EXISTS idx_pigs_farm_id;
      DROP INDEX IF EXISTS idx_pigs_pig_id;
      DROP INDEX IF EXISTS idx_pigs_pen_id;
      DROP INDEX IF EXISTS idx_pigs_status;
      DROP INDEX IF EXISTS idx_pens_row_id;
      DROP INDEX IF EXISTS idx_pens_farm_id;
      DROP INDEX IF EXISTS idx_pens_name;
      DROP INDEX IF EXISTS idx_pens_is_occupied;
      DROP INDEX IF EXISTS idx_rows_farm_id;
      DROP INDEX IF EXISTS idx_rows_name;
      DROP INDEX IF EXISTS idx_pen_pig_history_pen_id;
      DROP INDEX IF EXISTS idx_pen_pig_history_pig_id;
      DROP INDEX IF EXISTS idx_breeding_records_farm_id;
      DROP INDEX IF EXISTS idx_breeding_records_sow_id;
      DROP INDEX IF EXISTS idx_breeding_records_boar_id;
      DROP INDEX IF EXISTS idx_piglet_records_breeding_record_id;
      DROP INDEX IF EXISTS idx_piglet_records_farm_id;
      DROP INDEX IF EXISTS idx_health_records_pig_id;
      DROP INDEX IF EXISTS idx_health_records_date;
      DROP INDEX IF EXISTS idx_feeding_records_pig_id;
      DROP INDEX IF EXISTS idx_feeding_records_pen_id;
      DROP INDEX IF EXISTS idx_feeding_records_date;
      DROP INDEX IF EXISTS idx_earnings_records_farm_id;
      DROP INDEX IF EXISTS idx_earnings_records_date;
      DROP INDEX IF EXISTS idx_production_records_farm_id;
      DROP INDEX IF EXISTS idx_production_records_date;
      DROP INDEX IF EXISTS idx_notifications_user_id;
      DROP INDEX IF EXISTS idx_notifications_is_read;
      DROP INDEX IF EXISTS idx_activity_logs_user_id;
      DROP INDEX IF EXISTS idx_activity_logs_farm_id;
    `,
  },
  {
    version: 8,
    name: "create_pig_birth_history_table",
    up: `
      -- Create pig_birth_history table
      CREATE TABLE IF NOT EXISTS pig_birth_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        sow_id VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
        breeding_record_id UUID REFERENCES breeding_records(id) ON DELETE SET NULL,
        birth_date DATE NOT NULL,
        number_of_piglets INTEGER NOT NULL CHECK (number_of_piglets >= 0),
        notes TEXT,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create index for pig_birth_history
      CREATE INDEX IF NOT EXISTS idx_pig_birth_history_farm_id ON pig_birth_history(farm_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pig_birth_history_sow_id ON pig_birth_history(sow_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pig_birth_history_breeding_record_id ON pig_birth_history(breeding_record_id) WHERE is_deleted = 0;

      -- Create trigger for updated_at
      CREATE TRIGGER update_pig_birth_history_updated_at
      BEFORE UPDATE ON pig_birth_history
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();

      -- Create function to update pigs.total_litters and total_piglets
      CREATE OR REPLACE FUNCTION update_pig_birth_stats()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE pigs
        SET total_litters = (
          SELECT COUNT(*)
          FROM pig_birth_history
          WHERE sow_id = NEW.sow_id
          AND farm_id = NEW.farm_id
          AND is_deleted = 0
        ),
        total_piglets = (
          SELECT COALESCE(SUM(number_of_piglets), 0)
          FROM pig_birth_history
          WHERE sow_id = NEW.sow_id
          AND farm_id = NEW.farm_id
          AND is_deleted = 0
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE pig_id = NEW.sow_id
        AND farm_id = NEW.farm_id
        AND is_deleted = 0;
        RETURN NEW;
      END;
      $$ language 'plpgsql';

      -- Create trigger for pig_birth_history to update pig stats
      CREATE TRIGGER update_pig_birth_stats
      AFTER INSERT OR UPDATE OF number_of_piglets, is_deleted
      ON pig_birth_history
      FOR EACH ROW
      EXECUTE FUNCTION update_pig_birth_stats();
    `,
    down: `
      -- Drop trigger and function
      DROP TRIGGER IF EXISTS update_pig_birth_stats ON pig_birth_history;
      DROP FUNCTION IF EXISTS update_pig_birth_stats;
      DROP TRIGGER IF EXISTS update_pig_birth_history_updated_at ON pig_birth_history;

      -- Drop indexes
      DROP INDEX IF EXISTS idx_pig_birth_history_farm_id;
      DROP INDEX IF EXISTS idx_pig_birth_history_sow_id;
      DROP INDEX IF EXISTS idx_pig_birth_history_breeding_record_id;

      -- Drop table
      DROP TABLE IF EXISTS pig_birth_history CASCADE;
    `,
  },
  {
    version: 9,
    name: "create_alerts_table",
    up: `
      -- Create function to update updated_on timestamp
      CREATE OR REPLACE FUNCTION update_updated_on_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_on = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';

      -- Create alerts table
      CREATE TABLE IF NOT EXISTS alerts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        alert_start_date TIMESTAMP WITH TIME ZONE NOT NULL,
        alert_end_date TIMESTAMP WITH TIME ZONE,
        alert_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
        message TEXT NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'sent', 'completed', 'rejected')),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        pig_id VARCHAR(200) REFERENCES pigs(pig_id) ON DELETE SET NULL,
        pen_id UUID REFERENCES pens(id) ON DELETE SET NULL,
        notify_on DATE[] NOT NULL DEFAULT '{}',
        created_on TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_on TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        is_deleted BOOLEAN DEFAULT false
      );

      -- Create indexes for alerts
      CREATE INDEX IF NOT EXISTS idx_alerts_farm_id ON alerts(farm_id) WHERE is_deleted = false;
      CREATE INDEX IF NOT EXISTS idx_alerts_alert_start_date ON alerts(alert_start_date) WHERE is_deleted = false;
      CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status) WHERE is_deleted = false;
      CREATE INDEX IF NOT EXISTS idx_alerts_is_active ON alerts(is_active) WHERE is_deleted = false;
      CREATE INDEX IF NOT EXISTS idx_alerts_notify_on ON alerts USING GIN (notify_on) WHERE is_deleted = false;

      -- Create trigger for updated_on
      CREATE TRIGGER update_alerts_updated_on
      BEFORE UPDATE ON alerts
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_on_column();
    `,
    down: `
      -- Drop trigger
      DROP TRIGGER IF EXISTS update_alerts_updated_on ON alerts;

      -- Drop indexes
      DROP INDEX IF EXISTS idx_alerts_farm_id;
      DROP INDEX IF EXISTS idx_alerts_alert_start_date;
      DROP INDEX IF EXISTS idx_alerts_status;
      DROP INDEX IF EXISTS idx_alerts_is_active;
      DROP INDEX IF EXISTS idx_alerts_notify_on;

      -- Drop table
      DROP TABLE IF EXISTS alerts CASCADE;

      -- Drop function
      DROP FUNCTION IF EXISTS update_updated_on_column;
    `,
  },
  {
    version: 10,
    name: "create_email_logs_table",
    up: `
      -- Create email_logs table
      CREATE TABLE IF NOT EXISTS email_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        farm_id UUID REFERENCES farms(id) ON DELETE SET NULL,
        count INTEGER NOT NULL CHECK (count = 1),
        date DATE NOT NULL,
        is_active INTEGER DEFAULT 0 CHECK (is_active IN (0, 1)),
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes for email_logs
      CREATE INDEX IF NOT EXISTS idx_email_logs_farm_id ON email_logs(farm_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_email_logs_date ON email_logs(date) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_email_logs_is_active ON email_logs(is_active) WHERE is_deleted = 0;

      -- Create trigger for updated_at
      CREATE TRIGGER update_email_logs_updated_at
      BEFORE UPDATE ON email_logs
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `,
    down: `
      -- Drop trigger
      DROP TRIGGER IF EXISTS update_email_logs_updated_at ON email_logs;

      -- Drop indexes
      DROP INDEX IF EXISTS idx_email_logs_farm_id;
      DROP INDEX IF EXISTS idx_email_logs_user_id;
      DROP INDEX IF EXISTS idx_email_logs_date;
      DROP INDEX IF EXISTS idx_email_logs_is_active;

      -- Drop table
      DROP TABLE IF EXISTS email_logs CASCADE;
    `,
  },
  {
    version: 11,
    name: "add_payment_module",
    up: `
      -- Create payments table
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        farm_id UUID REFERENCES farms(id) ON DELETE SET NULL,
        plan VARCHAR(50) NOT NULL CHECK (plan IN ('standard', 'advanced', 'free')),
        amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
        currency VARCHAR(3) DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
        payment_mode VARCHAR(50) NOT NULL CHECK (payment_mode IN ('mpesa', 'dpogroup', 'card', 'stripe', 'paypal')),
        phone_number VARCHAR(20),
        transaction_id VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
        metadata JSONB DEFAULT '{}',
        is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes for payments
      CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_payments_farm_id ON payments(farm_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments(transaction_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at) WHERE is_deleted = 0;

      -- Create trigger for updated_at
      CREATE TRIGGER update_payments_updated_at
      BEFORE UPDATE ON payments
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `,
    down: `
      -- Drop trigger
      DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;

      -- Drop indexes
      DROP INDEX IF EXISTS idx_payments_user_id;
      DROP INDEX IF EXISTS idx_payments_farm_id;
      DROP INDEX IF EXISTS idx_payments_status;
      DROP INDEX IF EXISTS idx_payments_transaction_id;
      DROP INDEX IF EXISTS idx_payments_created_at;

      -- Drop table
      DROP TABLE IF EXISTS payments CASCADE;
    `,
  },
  {
    version: 12,
    name: "create_pig_transfer_history_table",
    up: `
      -- Create pig_transfer_history table
      CREATE TABLE IF NOT EXISTS pig_transfer_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
        pig_id VARCHAR(200) NOT NULL REFERENCES pigs(pig_id) ON DELETE CASCADE,
        old_pen_id UUID REFERENCES pens(id) ON DELETE SET NULL,
        new_pen_id UUID NOT NULL REFERENCES pens(id) ON DELETE RESTRICT,
        transfer_reason VARCHAR(100) NOT NULL CHECK (transfer_reason IN (
          'quarantine',
          'cannibalism_prevention',
          'breeding_program',
          'overcrowding',
          'facility_maintenance',
          'social_grouping',
          'other'
        )),
        transfer_notes TEXT,
        transferred_by UUID REFERENCES users(id) ON DELETE SET NULL,
        transferred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes for pig_transfer_history
      CREATE INDEX IF NOT EXISTS idx_pig_transfer_history_farm_id ON pig_transfer_history(farm_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pig_transfer_history_pig_id ON pig_transfer_history(pig_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pig_transfer_history_old_pen_id ON pig_transfer_history(old_pen_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pig_transfer_history_new_pen_id ON pig_transfer_history(new_pen_id) WHERE is_deleted = 0;
      CREATE INDEX IF NOT EXISTS idx_pig_transfer_history_transferred_at ON pig_transfer_history(transferred_at) WHERE is_deleted = 0;

      -- Create trigger for updated_at
      CREATE TRIGGER update_pig_transfer_history_updated_at
      BEFORE UPDATE ON pig_transfer_history
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `,
    down: `
      -- Drop trigger
      DROP TRIGGER IF EXISTS update_pig_transfer_history_updated_at ON pig_transfer_history;

      -- Drop indexes
      DROP INDEX IF EXISTS idx_pig_transfer_history_farm_id;
      DROP INDEX IF EXISTS idx_pig_transfer_history_pig_id;
      DROP INDEX IF EXISTS idx_pig_transfer_history_old_pen_id;
      DROP INDEX IF EXISTS idx_pig_transfer_history_new_pen_id;
      DROP INDEX IF EXISTS idx_pig_transfer_history_transferred_at;

      -- Drop table
      DROP TABLE IF EXISTS pig_transfer_history CASCADE;
    `,
  },
  {
    version: 13,
    name: "create_feeding_period_records_table",
    up: `
    -- Create feeding_period_records table for weekly/monthly bulk feeding records
    CREATE TABLE IF NOT EXISTS feeding_period_records (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      pen_id UUID REFERENCES pens(id) ON DELETE SET NULL,
      record_type VARCHAR(20) NOT NULL CHECK (record_type IN ('weekly', 'monthly')),
      feed_type VARCHAR(50) NOT NULL,
      total_amount VARCHAR(50) NOT NULL,
      unit VARCHAR(20) DEFAULT 'kg',
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      pigs_in_pen JSONB DEFAULT '[]',
      notes TEXT,
      fed_by UUID REFERENCES users(id),
      is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_feeding_period_records_farm_id ON feeding_period_records(farm_id) WHERE is_deleted = 0;
    CREATE INDEX IF NOT EXISTS idx_feeding_period_records_pen_id ON feeding_period_records(pen_id) WHERE is_deleted = 0;
    CREATE INDEX IF NOT EXISTS idx_feeding_period_records_dates ON feeding_period_records(start_date, end_date) WHERE is_deleted = 0;
    CREATE INDEX IF NOT EXISTS idx_feeding_period_records_type ON feeding_period_records(record_type) WHERE is_deleted = 0;

    -- Create trigger for updated_at
    CREATE TRIGGER update_feeding_period_records_updated_at
    BEFORE UPDATE ON feeding_period_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

    -- Modify feeding_records to add record_type
    ALTER TABLE feeding_records ADD COLUMN IF NOT EXISTS record_type VARCHAR(20) DEFAULT 'daily' CHECK (record_type IN ('daily', 'weekly', 'monthly'));
  `,
    down: `
    -- Drop trigger
    DROP TRIGGER IF EXISTS update_feeding_period_records_updated_at ON feeding_period_records;

    -- Drop indexes
    DROP INDEX IF EXISTS idx_feeding_period_records_farm_id;
    DROP INDEX IF EXISTS idx_feeding_period_records_pen_id;
    DROP INDEX IF EXISTS idx_feeding_period_records_dates;
    DROP INDEX IF EXISTS idx_feeding_period_records_type;

    -- Drop table
    DROP TABLE IF EXISTS feeding_period_records CASCADE;

    -- Remove column from feeding_records
    ALTER TABLE feeding_records DROP COLUMN IF EXISTS record_type;
  `,
  },
];

async function runMigrations() {
  let client;

  try {
    // Verify database connection
    client = await pool.connect();
    logger.info("Successfully connected to the database");

    // Create migrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Get executed migrations
    const result = await client.query(
      "SELECT version FROM migrations ORDER BY version"
    );
    const executedVersions = result.rows.map(row => row.version);

    // Apply migrations
    for (const migration of migrations) {
      if (!executedVersions.includes(migration.version)) {
        logger.info(
          `Applying migration ${migration.version}: ${migration.name}`
        );
        await client.query("BEGIN");
        try {
          await client.query(migration.up);
          await client.query(
            "INSERT INTO migrations (version, name) VALUES ($1, $2)",
            [migration.version, migration.name]
          );
          await client.query("COMMIT");
          logger.info(`Migration ${migration.version} applied successfully`);
        } catch (err) {
          await client.query("ROLLBACK");
          logger.error(`Migration ${migration.version} failed: ${err.message}`);
          throw new Error(
            `Migration ${migration.version} failed: ${err.message}`
          );
        }
      } else {
        logger.info(`Skipping migration ${migration.version}: already applied`);
      }
    }

    logger.info("All migrations completed successfully");
  } catch (error) {
    logger.error("Migration process failed:", error.message);
    throw new Error(`Migration process failed: ${error.message}`);
  } finally {
    if (client) {
      client.release();
      logger.info("Database connection released");
    }
  }
}

// runMigrations();

export default runMigrations;
