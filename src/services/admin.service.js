import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { DatabaseHelper, pool } from '../config/database.js';
import { UnauthorizedError, ValidationError } from '../middleware/errors.js';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const encodeBase32 = bytes => {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += base32Alphabet[(value << (5 - bits)) & 31];
  return output;
};

const decodeBase32 = value => {
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const character of value.toUpperCase().replace(/=+$/g, '')) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) throw new ValidationError('Invalid MFA secret');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

const encryptionKey = () => {
  const encoded = process.env.ADMIN_MFA_ENCRYPTION_KEY;
  if (!encoded) throw new Error('ADMIN_MFA_ENCRYPTION_KEY must be configured');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('ADMIN_MFA_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  return key;
};

const encryptSecret = secret => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.');
};

const decryptSecret = value => {
  const [iv, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

const verifyTotp = (secret, code, now = Date.now()) => {
  if (!/^\d{6}$/.test(String(code ?? ''))) return false;
  const key = decodeBase32(secret);
  const counter = Math.floor(now / 30000);
  const supplied = Buffer.from(String(code));
  for (let offset = -1; offset <= 1; offset += 1) {
    const data = Buffer.alloc(8);
    data.writeBigUInt64BE(BigInt(counter + offset));
    const digest = createHmac('sha1', key).update(data).digest();
    const index = digest[digest.length - 1] & 0x0f;
    const value = (((digest[index] & 0x7f) << 24)
      | ((digest[index + 1] & 0xff) << 16)
      | ((digest[index + 2] & 0xff) << 8)
      | (digest[index + 3] & 0xff)) % 1000000;
    if (timingSafeEqual(supplied, Buffer.from(String(value).padStart(6, '0')))) return true;
  }
  return false;
};

const createTotpSecret = () => encodeBase32(randomBytes(20));

const periodStart = period => {
  const days = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 };
  if (!Object.hasOwn(days, period)) {
    throw new ValidationError('Period must be one of 7d, 30d, 90d, 12m');
  }
  return new Date(Date.now() - days[period] * 86400000).toISOString();
};

const recordAudit = (admin, action, ipAddress, filters = {}) =>
  DatabaseHelper.executeQuery(
    `INSERT INTO admin_audit_logs (actor_user_id, action, ip_address, filters)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [admin.id, action, ipAddress || null, JSON.stringify(filters)]
  );

export default class AdminService {
  static async enrollMfa(userId, otp) {
    const result = await DatabaseHelper.executeQuery(
      `SELECT u.email, u.admin_mfa_secret, r.name AS role_name FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.is_active = 1 AND u.is_deleted = 0
         AND r.name IN ('superadmin', 'partner')`,
      [userId]
    );
    if (!result.rows.length) throw new UnauthorizedError('Admin account required');
    const user = result.rows[0];
    let secret;
    if (user.admin_mfa_secret) {
      secret = decryptSecret(user.admin_mfa_secret);
    } else {
      secret = createTotpSecret();
      await DatabaseHelper.executeQuery(
        'UPDATE users SET admin_mfa_secret = $1 WHERE id = $2',
        [encryptSecret(secret), userId]
      );
    }
    if (otp && verifyTotp(secret, otp)) {
      await DatabaseHelper.executeQuery(
        'UPDATE users SET admin_mfa_enabled = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [userId]
      );
      return { enabled: true };
    }
    if (otp) throw new UnauthorizedError('Invalid MFA code');
    return {
      enabled: false,
      secret,
      otpauthUrl: `otpauth://totp/PigMaster:${encodeURIComponent(user.email)}?secret=${secret}&issuer=PigMaster&algorithm=SHA1&digits=6&period=30`,
    };
  }

  static async login(email, password) {
    const userResult = await DatabaseHelper.executeQuery(
      `SELECT u.id, u.email, u.password_hash, u.admin_mfa_secret, u.admin_mfa_enabled,
              r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE lower(u.email) = lower($1) AND u.is_active = 1 AND u.is_deleted = 0
         AND r.name IN ('superadmin', 'partner') AND r.is_active = 1 AND r.is_deleted = 0`,
      [email]
    );
    const user = userResult.rows[0];
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedError('Invalid email or password');
    }
    if (!process.env.ADMIN_JWT_SECRET || process.env.ADMIN_JWT_SECRET.length < 32) {
      throw new Error('ADMIN_JWT_SECRET must contain at least 32 characters');
    }
    const needsSetup = !user.admin_mfa_enabled || !user.admin_mfa_secret;
    const secret = needsSetup ? createTotpSecret() : decryptSecret(user.admin_mfa_secret);
    if (needsSetup) {
      await DatabaseHelper.executeQuery(
        'UPDATE users SET admin_mfa_secret = $1 WHERE id = $2',
        [encryptSecret(secret), user.id]
      );
    }
    const challengeToken = jwt.sign(
      { userId: user.id, realm: needsSetup ? 'admin-mfa-setup' : 'admin-mfa' },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn: '5m', audience: 'pigmaster-admin-mfa', issuer: 'pigmaster-api' }
    );
    return {
      mfa_required: true,
      mfa_setup_required: needsSetup,
      challengeToken,
      ...(needsSetup && {
        secret,
        otpauthUrl: `otpauth://totp/PigMaster:${encodeURIComponent(user.email)}?secret=${secret}&issuer=PigMaster&algorithm=SHA1&digits=6&period=30`,
      }),
    };
  }

  static async verifyMfa(challengeToken, otp) {
    if (!process.env.ADMIN_JWT_SECRET || process.env.ADMIN_JWT_SECRET.length < 32) {
      throw new Error('ADMIN_JWT_SECRET must contain at least 32 characters');
    }
    let claims;
    try {
      claims = jwt.verify(challengeToken, process.env.ADMIN_JWT_SECRET, {
        audience: 'pigmaster-admin-mfa',
        issuer: 'pigmaster-api',
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedError('Admin login challenge expired');
    }
    const result = await DatabaseHelper.executeQuery(
      `SELECT u.id, u.admin_mfa_secret, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1
         AND u.is_active = 1 AND u.is_deleted = 0
         AND r.name IN ('superadmin', 'partner') AND r.is_active = 1 AND r.is_deleted = 0`,
      [claims.userId]
    );
    const user = result.rows[0];
    if (!user || !user.admin_mfa_secret
      || !verifyTotp(decryptSecret(user.admin_mfa_secret), otp)) {
      throw new UnauthorizedError('Invalid MFA code');
    }
    if (claims.realm === 'admin-mfa-setup') {
      await DatabaseHelper.executeQuery(
        'UPDATE users SET admin_mfa_enabled = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );
    } else if (claims.realm !== 'admin-mfa' || !user.admin_mfa_enabled) {
      throw new UnauthorizedError('Admin MFA setup required');
    }
    const token = jwt.sign(
      { userId: user.id, realm: 'admin', role: user.role_name },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn: '2h', audience: 'pigmaster-admin', issuer: 'pigmaster-api' }
    );
    return { token, role: user.role_name === 'superadmin' ? 'SUPER_ADMIN' : 'PARTNER' };
  }

  static async overview(admin, ip, period) {
    const since = periodStart(period);
    await recordAudit(admin, 'analytics.overview.read', ip, { period });
    const [customers, farms, pigs, revenue, subscriptions, trends] = await Promise.all([
      DatabaseHelper.executeQuery(
        `SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE last_login >= CURRENT_TIMESTAMP - INTERVAL '30 days')::int AS active,
         COUNT(*) FILTER (WHERE created_at >= $1)::int AS new
         FROM users WHERE is_deleted = 0 AND role_id IN
         (SELECT id FROM roles WHERE name NOT IN ('superadmin', 'partner'))`,
        [since]
      ),
      DatabaseHelper.executeQuery('SELECT COUNT(*)::int AS total FROM farms WHERE is_deleted = 0'),
      DatabaseHelper.executeQuery('SELECT COUNT(*)::int AS total FROM pigs WHERE is_deleted = 0'),
      DatabaseHelper.executeQuery(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS total, currency
         FROM payments WHERE status = 'success' AND is_deleted = 0 AND created_at >= $1
         GROUP BY currency ORDER BY currency`,
        [since]
      ),
      DatabaseHelper.executeQuery(
        `SELECT s.status, COUNT(*)::int AS count
         FROM subscriptions s WHERE s.is_active = 1 GROUP BY s.status ORDER BY s.status`
      ),
      DatabaseHelper.executeQuery(
        `SELECT date_trunc('day', created_at)::date AS date, COUNT(*)::int AS signups
         FROM users WHERE is_deleted = 0 AND created_at >= $1
         GROUP BY 1 ORDER BY 1`,
        [since]
      ),
    ]);
    const revenueByCurrency = revenue.rows.map(row => ({
      currency: row.currency,
      amount: Number(row.total),
    }));
    const totalRevenue = revenueByCurrency
      .filter(row => row.currency === 'KES')
      .reduce((sum, row) => sum + row.amount, 0);
    return {
      period,
      lastUpdatedAt: new Date().toISOString(),
      customers: customers.rows[0],
      farms: farms.rows[0].total,
      pigs: pigs.rows[0].total,
      totalCustomers: customers.rows[0].total,
      activeFarmers: customers.rows[0].active,
      totalRevenue,
      totalPigs: pigs.rows[0].total,
      revenueByCurrency,
      subscriptions: subscriptions.rows,
      signupTrend: trends.rows,
    };
  }

  static async revenue(admin, ip, period) {
    const since = periodStart(period);
    const bucket = period === '12m' ? 'month' : period === '90d' ? 'week' : 'day';
    await recordAudit(admin, 'analytics.revenue.read', ip, { period });
    const result = await DatabaseHelper.executeQuery(
      `SELECT date_trunc('${bucket}', created_at)::date AS month, currency,
         COUNT(*) FILTER (WHERE status = 'success')::int AS successful,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0)::numeric AS gross
       FROM payments WHERE is_deleted = 0 AND created_at >= $1
       GROUP BY 1, 2 ORDER BY 1, 2`,
      [since]
    );
    const rows = result.rows.map(row => ({
      ...row,
      gross: Number(row.gross),
    }));
    return {
      period,
      lastUpdatedAt: new Date().toISOString(),
      points: rows.filter(row => row.currency === 'KES')
        .map(row => ({ month: row.month, amount: row.gross })),
      rows,
    };
  }

  static async herd(admin, ip, period) {
    const since = periodStart(period);
    await recordAudit(admin, 'analytics.herd.read', ip, { period });
    const [gender, breed, monthly] = await Promise.all([
      DatabaseHelper.executeQuery(
        `SELECT gender, COUNT(*)::int AS count, COUNT(DISTINCT farm_id)::int AS farms
         FROM pigs WHERE is_deleted = 0 GROUP BY gender ORDER BY gender`
      ),
      DatabaseHelper.executeQuery(
        `SELECT breed, COUNT(*)::int AS count, COUNT(DISTINCT farm_id)::int AS farms
         FROM pigs WHERE is_deleted = 0 GROUP BY breed ORDER BY count DESC LIMIT 20`
      ),
      DatabaseHelper.executeQuery(
        `SELECT date_trunc('month', created_at)::date AS month, COUNT(*)::int AS records
         FROM breeding_records WHERE is_deleted = 0 AND created_at >= $1
         GROUP BY 1 ORDER BY 1`,
        [since]
      ),
    ]);
    const redactSmallCohorts = rows => admin.role_name === 'superadmin'
      ? rows.map(({ farms: _farms, ...row }) => row)
      : rows.filter(row => row.farms >= 5).map(({ farms: _farms, ...row }) => row);
    const genderSegments = redactSmallCohorts(gender.rows).map(row => ({
      name: row.gender,
      value: row.count,
    }));
    return {
      period,
      lastUpdatedAt: new Date().toISOString(),
      segments: genderSegments,
      gender: redactSmallCohorts(gender.rows),
      breed: redactSmallCohorts(breed.rows),
      breedingTrend: monthly.rows,
    };
  }

  static async customers(admin, ip, { page, pageSize, search }) {
    const offset = (page - 1) * pageSize;
    const safeSearch = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    await recordAudit(admin, 'customers.list.read', ip, { page, pageSize, search });
    const [result, countResult] = await Promise.all([
      DatabaseHelper.executeQuery(
      `SELECT u.id, u.name, u.email, u.created_at AS "createdAt", u.last_login AS "lastActivity",
              r.name AS type, COALESCE(s.status, 'trial') AS status,
              (SELECT COUNT(*)::int FROM farms f WHERE f.created_by = u.id AND f.is_deleted = 0) AS farms,
              (SELECT COUNT(*)::int FROM pigs p JOIN farms f ON f.id = p.farm_id
               WHERE f.created_by = u.id AND p.is_deleted = 0) AS pigs
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN LATERAL (
         SELECT status FROM subscriptions WHERE user_id = u.id AND is_active = 1
         ORDER BY created_at DESC LIMIT 1
       ) s ON true
       WHERE u.is_deleted = 0 AND r.name NOT IN ('superadmin', 'partner')
         AND ($1 = '%%' OR u.name ILIKE $1 OR u.email ILIKE $1)
       ORDER BY u.created_at DESC LIMIT $2 OFFSET $3`,
      [safeSearch, pageSize, offset]),
      DatabaseHelper.executeQuery(
        `SELECT COUNT(*)::int AS total FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.is_deleted = 0 AND r.name NOT IN ('superadmin', 'partner')
           AND ($1 = '%%' OR u.name ILIKE $1 OR u.email ILIKE $1)`,
        [safeSearch]
      ),
    ]);
    return { page, pageSize, total: countResult.rows[0].total, customers: result.rows };
  }

  static async audit(admin, ip, { page, pageSize }) {
    await recordAudit(admin, 'audit.list.read', ip, { page, pageSize });
    const [result, countResult] = await Promise.all([
      DatabaseHelper.executeQuery(
      `SELECT a.id, a.action, a.ip_address AS "ipAddress", a.filters,
              a.created_at AS "createdAt", u.email AS actor
       FROM admin_audit_logs a JOIN users u ON u.id = a.actor_user_id
       ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize]),
      DatabaseHelper.executeQuery(
        'SELECT COUNT(*)::int AS total FROM admin_audit_logs'
      ),
    ]);
    return { page, pageSize, total: countResult.rows[0].total, audit: result.rows };
  }

  static async refreshDailyRollup() {
    const client = await pool.connect();
    try {
      const lock = await client.query('SELECT pg_try_advisory_lock(843271904) AS acquired');
      if (!lock.rows[0]?.acquired) return false;
      await client.query(`
        INSERT INTO analytics_daily_rollup (rollup_date, metrics, refreshed_at)
        VALUES (CURRENT_DATE, jsonb_build_object(
          'users', (SELECT COUNT(*) FROM users WHERE is_deleted = 0),
          'farms', (SELECT COUNT(*) FROM farms WHERE is_deleted = 0),
          'pigs', (SELECT COUNT(*) FROM pigs WHERE is_deleted = 0),
          'paidRevenue', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'currency', currency, 'amount', amount)), '[]'::jsonb)
            FROM (SELECT currency, SUM(amount)::numeric AS amount FROM payments
              WHERE is_deleted = 0 AND status = 'success' GROUP BY currency) revenue)
        ), CURRENT_TIMESTAMP)
        ON CONFLICT (rollup_date) DO UPDATE
          SET metrics = EXCLUDED.metrics, refreshed_at = CURRENT_TIMESTAMP
      `);
      return true;
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(843271904)');
      } finally {
        client.release();
      }
    }
  }
}
