import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/database.js';

const required = [
  'BOOTSTRAP_ADMIN_EMAIL',
  'BOOTSTRAP_ADMIN_NAME',
  'BOOTSTRAP_ADMIN_PHONE',
  'BOOTSTRAP_ADMIN_PASSWORD',
];

const missing = required.filter(key => !process.env[key]?.trim());
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exitCode = 1;
} else if (process.env.BOOTSTRAP_ADMIN_PASSWORD.length < 12) {
  console.error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
  process.exitCode = 1;
} else {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
  const name = process.env.BOOTSTRAP_ADMIN_NAME.trim();
  const phone = process.env.BOOTSTRAP_ADMIN_PHONE.trim();
  const passwordHash = await bcrypt.hash(process.env.BOOTSTRAP_ADMIN_PASSWORD, 12);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pigmaster:first-superadmin-bootstrap'))");

    const existingSuperAdmin = await client.query(
      `SELECT u.id FROM users u JOIN admin_roles ar ON ar.id = u.admin_role_id
       WHERE ar.is_super AND u.is_deleted = 0
       LIMIT 1`
    );
    if (existingSuperAdmin.rows.length) {
      throw new Error('A Super Admin already exists. Bootstrap is only allowed once; add more admins from the dashboard.');
    }

    const existingUser = await client.query(
      'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1',
      [email]
    );
    if (existingUser.rows.length) {
      throw new Error('That email already belongs to an account. Use a new dedicated admin email.');
    }

    // The super admin role is created by the initial schema; it always has full access.
    const roleResult = await client.query("SELECT id FROM admin_roles WHERE key = 'super_admin' AND is_super");
    if (!roleResult.rows.length) throw new Error('The super_admin role is missing. Run the database migrations first.');

    await client.query(
      `INSERT INTO users (
         id, email, password_hash, name, phone, admin_role_id, farm_id,
         email_verified, is_active, is_deleted, preferences, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NULL, true, 1, 0, '{}'::jsonb, CURRENT_TIMESTAMP)`,
      [randomUUID(), email, passwordHash, name, phone, roleResult.rows[0].id]
    );

    await client.query('COMMIT');
    console.log(`Initial Super Admin created for ${email}. Sign in at the admin dashboard with this email and password.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Super Admin bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (missing.length || process.env.BOOTSTRAP_ADMIN_PASSWORD?.length < 12) {
  await pool.end();
}
