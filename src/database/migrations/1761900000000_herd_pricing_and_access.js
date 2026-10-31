import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlFile = name => readFileSync(join(__dirname, '..', 'sql', name), 'utf8');

export const shorthands = undefined;

/**
 * Brings databases created before these features up to date: consents, admin roles,
 * subscription notices, herd-size pricing and the farm role changes. Idempotent, so it
 * is a no-op on a fresh database where the initial schema already has all of it.
 */
export async function up(pgm) {
  pgm.sql(sqlFile('herd_pricing_and_access.up.sql'));
}

// These objects also belong to the initial schema, so rolling back leaves them in place.
export async function down() {}
