DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS subscription_plans CASCADE;
DROP TABLE IF EXISTS token_blacklist CASCADE;
DROP TABLE IF EXISTS password_resets CASCADE;
DROP TABLE IF EXISTS farms CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
-- Leave the uuid-ossp extension installed because many tables and defaults depend on it.
-- Dropping it here causes PostgreSQL to reject the migration with dependency errors.
