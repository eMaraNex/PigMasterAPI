import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const shorthands = undefined;

export async function up(pgm) {
  const schemaSql = readFileSync(join(__dirname, '1740000000000_initial_schema.up.sql'), 'utf8');
  await pgm.db.query(schemaSql);
}

export async function down(pgm) {
  const schemaSql = readFileSync(join(__dirname, '1740000000000_initial_schema.down.sql'), 'utf8');
  await pgm.db.query(schemaSql);
}
