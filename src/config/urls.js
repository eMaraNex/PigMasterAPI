/*
 * Public addresses used in emails and links. One place, so every link points to the right host.
 *
 * Preferred: CLIENT_BASE_URL (farmer app) and API_BASE_URL (this API).
 * Also understood: PROD_CLIENT_BASE_URL / DEV_CLIENT_BASE_URL, PROD_BASE_URL / PROD_BACKEND_URL /
 * DEV_BACKEND_URL / BASE_URL, chosen by NODE_ENV, with the other environment's value as a fallback.
 */
const isProduction = () => process.env.NODE_ENV === 'production';
const first = (...names) => names.map(name => process.env[name]?.trim()).find(Boolean);
const clean = url => url.replace(/\/+$/, '').replace(/\/api\/v1$/, '');

/** Farmer app origin, e.g. https://pigmaster.emaranex.com (reset, invite and pricing links). */
export const clientBaseUrl = () => clean(
  first('CLIENT_BASE_URL', ...(isProduction() ? ['PROD_CLIENT_BASE_URL', 'DEV_CLIENT_BASE_URL'] : ['DEV_CLIENT_BASE_URL', 'PROD_CLIENT_BASE_URL']))
  ?? 'http://localhost:3000'
);

/** API origin without /api/v1, e.g. https://pigmasterapi.emaranex.com (email verification links). */
export const apiBaseUrl = () => clean(
  first('API_BASE_URL', ...(isProduction()
    ? ['PROD_BASE_URL', 'PROD_BACKEND_URL', 'BASE_URL', 'DEV_BACKEND_URL']
    : ['DEV_BACKEND_URL', 'BASE_URL', 'PROD_BASE_URL', 'PROD_BACKEND_URL']))
  ?? `http://localhost:${process.env.PORT || 5000}`
);
