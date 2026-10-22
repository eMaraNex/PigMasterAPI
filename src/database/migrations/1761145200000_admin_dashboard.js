export async function up(pgm) {
  pgm.sql(`
    INSERT INTO roles (name, description, permissions, is_active, is_deleted)
    VALUES ('partner', 'Read-only platform analytics partner', '["platform_analytics"]'::jsonb, 1, 0)
    ON CONFLICT (name) DO NOTHING;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS admin_mfa_secret TEXT,
      ADD COLUMN IF NOT EXISTS admin_mfa_enabled BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(120) NOT NULL,
      ip_address INET,
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_admin_audit_created
      ON admin_audit_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_created
      ON admin_audit_logs (actor_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
      rollup_date DATE PRIMARY KEY,
      metrics JSONB NOT NULL,
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_active_created
      ON users (created_at DESC) WHERE is_deleted = 0;
    CREATE INDEX IF NOT EXISTS idx_farms_owner_created
      ON farms (created_by, created_at DESC) WHERE is_deleted = 0;
    CREATE INDEX IF NOT EXISTS idx_pigs_farm_status
      ON pigs (farm_id, status) WHERE is_deleted = 0;
    CREATE INDEX IF NOT EXISTS idx_payments_status_created
      ON payments (status, created_at DESC) WHERE is_deleted = 0;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_payments_status_created;
    DROP INDEX IF EXISTS idx_pigs_farm_status;
    DROP INDEX IF EXISTS idx_farms_owner_created;
    DROP INDEX IF EXISTS idx_users_active_created;
    DROP TABLE IF EXISTS analytics_daily_rollup;
    DROP INDEX IF EXISTS idx_admin_audit_actor_created;
    DROP INDEX IF EXISTS idx_admin_audit_created;
    DROP TABLE IF EXISTS admin_audit_logs;
    ALTER TABLE users DROP COLUMN IF EXISTS admin_mfa_enabled;
    ALTER TABLE users DROP COLUMN IF EXISTS admin_mfa_secret;
    DELETE FROM roles WHERE name = 'partner';
  `);
}
