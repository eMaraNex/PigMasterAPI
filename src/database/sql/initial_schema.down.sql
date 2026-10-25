DROP TABLE IF EXISTS
  user_consents,
  farm_members,
  farm_roles,
  pig_transfer_history,
  email_logs,
  alerts,
  pig_birth_history,
  file_uploads,
  system_settings,
  admin_audit_logs,
  activity_logs,
  notifications,
  expenses,
  removal_records,
  production_records,
  earnings_records,
  feed_inventory,
  feeding_records,
  feeding_schedules,
  vaccination_schedules,
  health_alerts,
  health_records,
  breeding_calendar,
  piglet_records,
  breeding_records,
  pen_pig_history,
  pigs,
  pens,
  rows,
  subscriptions,
  payments,
  subscription_plans,
  token_blacklist,
  password_resets,
  farms,
  users,
  roles
CASCADE;

DROP FUNCTION IF EXISTS sync_pen_occupancy();
DROP FUNCTION IF EXISTS update_pig_birth_stats();
DROP FUNCTION IF EXISTS update_row_occupied();
DROP FUNCTION IF EXISTS update_updated_on_column();
DROP FUNCTION IF EXISTS update_updated_at_column();
-- Leave the uuid-ossp extension installed because other databases objects may depend on it.
