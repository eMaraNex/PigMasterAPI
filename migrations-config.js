import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const buildDatabaseUrl = () => {
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const database = process.env.DB_NAME || 'pigmaster';
  const user = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || '';
  const sslmode = process.env.DB_SSLMODE || 'disable';

  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  return `postgresql://${auth}@${host}:${port}/${database}?sslmode=${sslmode}`;
};

const useLocalDbConfig = Boolean(process.env.DB_HOST || process.env.DB_NAME || process.env.DB_USER);
const localDatabaseUrl = buildDatabaseUrl();

if (useLocalDbConfig) {
  process.env.DATABASE_URL = localDatabaseUrl;
  process.env.PGHOST = process.env.DB_HOST || 'localhost';
  process.env.PGPORT = String(process.env.DB_PORT || 5432);
  process.env.PGDATABASE = process.env.DB_NAME || 'pigmaster';
  process.env.PGUSER = process.env.DB_USER || 'postgres';
  process.env.PGPASSWORD = process.env.DB_PASSWORD || '';
  process.env.PGSSLMODE = process.env.DB_SSLMODE || 'disable';
}

export default {
  dir: join(__dirname, 'src', 'database', 'migrations'),
  migrationsTable: 'pgmigrations',
  databaseUrl: useLocalDbConfig ? localDatabaseUrl : (process.env.DATABASE_URL || localDatabaseUrl),
  // Keep the existing pool-based config for local development
  dbClient: 'pg',
  migrationFileExtension: '.js',
};
