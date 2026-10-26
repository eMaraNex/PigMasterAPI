import { DatabaseHelper } from '../config/database.js';

/**
 * Version (publication date) of the legal documents shown to users. Bump these when the
 * privacy policy or terms change in a way people must agree to again; the UI shows the same dates.
 */
export const LEGAL_VERSIONS = {
  privacy_policy: process.env.PRIVACY_POLICY_VERSION || '2026-10-25',
  terms: process.env.TERMS_VERSION || '2026-10-25',
  marketing: process.env.PRIVACY_POLICY_VERSION || '2026-10-25',
};

/** Request details stored as evidence with every consent decision. */
export const consentContext = req => ({ ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 500) ?? null });

/**
 * Appends consent decisions. entries = [{ type: 'privacy_policy'|'terms'|'marketing', granted }].
 * Runs on `client` when given so it commits together with the account it belongs to.
 */
export const recordConsents = async ({ userId, entries, source, ip = null, userAgent = null }, client = null) => {
  if (!entries.length) return;
  const params = [];
  const values = entries.map(({ type, granted }) => {
    params.push(userId, type, Boolean(granted), LEGAL_VERSIONS[type], source, ip, userAgent);
    const n = params.length;
    return `($${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
  });
  const sql = `INSERT INTO user_consents (user_id, consent_type, granted, version, source, ip_address, user_agent)
               VALUES ${values.join(', ')}`;
  if (client) await client.query(sql, params);
  else await DatabaseHelper.executeQuery(sql, params);
};

/** Current state per consent type (latest decision wins). */
export const currentConsents = async userId => {
  const { rows } = await DatabaseHelper.executeQuery(
    `SELECT DISTINCT ON (consent_type) consent_type, granted, version, source, created_at
     FROM user_consents WHERE user_id = $1
     ORDER BY consent_type, created_at DESC`,
    [userId]
  );
  return Object.fromEntries(rows.map(row => [row.consent_type, row]));
};
