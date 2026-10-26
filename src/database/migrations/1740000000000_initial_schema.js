import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The SQL lives outside the migrations directory so node-pg-migrate never runs it as a migration of its own.
const sqlFile = name => readFileSync(join(__dirname, '..', 'sql', name), 'utf8');

export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(sqlFile('initial_schema.up.sql'));
}

export async function down(pgm) {
  pgm.sql(sqlFile('initial_schema.down.sql'));
}
