/*
 * Admin dashboard widgets. The dashboard endpoint returns every widget the caller's
 * role may see; the UI renders them generically by `kind`.
 *
 * Queries receive bound parameters only:
 *   $1 = period start, $2 = period end (both timestamptz)
 * `bucket` is substituted from a fixed whitelist (day | week | month), never from input.
 *
 * scope 'period'   -> the number reacts to the selected date range
 * scope 'snapshot' -> the number is the current total
 * minCohort        -> for partners, rows covering fewer than N farms are suppressed
 */
const ALL = ['SUPER_ADMIN', 'PARTNER'];
const SUPER = ['SUPER_ADMIN'];
const CUSTOMER = "u.is_deleted = 0 AND u.role_id NOT IN (SELECT id FROM roles WHERE name IN ('superadmin', 'partner'))";

export const dashboardWidgets = {
  total_farmers: {
    kind: 'stat', label: 'Total Farmers', icon: 'users', tone: 'indigo', scope: 'snapshot', roles: ALL,
    sql: `SELECT COUNT(*)::int AS value FROM users u WHERE ${CUSTOMER}`,
  },
  new_farmers: {
    kind: 'stat', label: 'New Farmers', icon: 'user-plus', tone: 'emerald', scope: 'period', roles: ALL,
    sql: `SELECT COUNT(*)::int AS value FROM users u WHERE ${CUSTOMER} AND u.created_at BETWEEN $1 AND $2`,
  },
  active_farmers: {
    kind: 'stat', label: 'Active Farmers', icon: 'activity', tone: 'sky', scope: 'period', roles: ALL,
    sql: `SELECT COUNT(*)::int AS value FROM users u WHERE ${CUSTOMER} AND u.last_login BETWEEN $1 AND $2`,
  },
  total_farms: {
    kind: 'stat', label: 'Total Farms', icon: 'warehouse', tone: 'amber', scope: 'snapshot', roles: ALL,
    sql: 'SELECT COUNT(*)::int AS value FROM farms WHERE is_deleted = 0',
  },
  total_pigs: {
    kind: 'stat', label: 'Pigs Recorded', icon: 'piggy-bank', tone: 'pink', scope: 'snapshot', roles: ALL,
    sql: 'SELECT COUNT(*)::int AS value FROM pigs WHERE is_deleted = 0',
  },
  revenue: {
    kind: 'stat', label: 'Revenue (KES)', icon: 'banknote', tone: 'emerald', scope: 'period', roles: SUPER, format: 'currency',
    sql: `SELECT COALESCE(SUM(amount), 0)::numeric AS value FROM payments
          WHERE status = 'success' AND currency = 'KES' AND is_deleted = 0 AND completed_at BETWEEN $1 AND $2`,
  },
  payments: {
    kind: 'breakdown', label: 'Payments', icon: 'credit-card', tone: 'violet', scope: 'period', roles: SUPER,
    breakdown: ['success', 'pending', 'failed'],
    sql: `SELECT COUNT(*)::int AS value,
            COUNT(*) FILTER (WHERE status = 'success')::int AS success,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status IN ('failed', 'cancelled'))::int AS failed
          FROM payments WHERE is_deleted = 0 AND created_at BETWEEN $1 AND $2`,
  },
  subscriptions: {
    kind: 'breakdown', label: 'Subscriptions', icon: 'badge-check', tone: 'sky', scope: 'snapshot', roles: ALL,
    breakdown: ['active', 'trial', 'expired'],
    sql: `SELECT COUNT(*)::int AS value,
            COUNT(*) FILTER (WHERE status = 'active')::int AS active,
            COUNT(*) FILTER (WHERE status = 'trial')::int AS trial,
            COUNT(*) FILTER (WHERE status = 'expired')::int AS expired
          FROM (SELECT DISTINCT ON (user_id) status FROM subscriptions WHERE is_active = 1
                ORDER BY user_id, created_at DESC) latest`,
  },

  signup_trend: {
    kind: 'chart', chart: 'area', label: 'Farmer Signups', scope: 'period', roles: ALL, span: 2,
    xKey: 'period', dataKeys: ['signups'],
    sql: `SELECT to_char(date_trunc('{bucket}', u.created_at), 'YYYY-MM-DD') AS period, COUNT(*)::int AS signups
          FROM users u WHERE ${CUSTOMER} AND u.created_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`,
  },
  revenue_trend: {
    kind: 'chart', chart: 'bar', label: 'Revenue (KES)', scope: 'period', roles: SUPER, span: 2,
    xKey: 'period', dataKeys: ['revenue'],
    sql: `SELECT to_char(date_trunc('{bucket}', completed_at), 'YYYY-MM-DD') AS period,
            COALESCE(SUM(amount), 0)::float AS revenue
          FROM payments WHERE status = 'success' AND currency = 'KES' AND is_deleted = 0
            AND completed_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`,
  },
  breeds: {
    kind: 'chart', chart: 'bar', orientation: 'horizontal', label: 'Top Breeds', scope: 'snapshot', roles: ALL,
    xKey: 'breed', dataKeys: ['pigs'], minCohort: 5,
    sql: `SELECT breed, COUNT(*)::int AS pigs, COUNT(DISTINCT farm_id)::int AS farms
          FROM pigs WHERE is_deleted = 0 GROUP BY breed ORDER BY pigs DESC LIMIT 10`,
  },
  gender: {
    kind: 'chart', chart: 'donut', label: 'Herd by Gender', scope: 'snapshot', roles: ALL,
    nameKey: 'gender', valueKey: 'pigs', minCohort: 5,
    sql: `SELECT gender, COUNT(*)::int AS pigs, COUNT(DISTINCT farm_id)::int AS farms
          FROM pigs WHERE is_deleted = 0 GROUP BY gender ORDER BY gender`,
  },
  plans: {
    kind: 'chart', chart: 'donut', label: 'Customers by Plan', scope: 'snapshot', roles: ALL,
    nameKey: 'plan', valueKey: 'customers',
    sql: `SELECT r.name AS plan, COUNT(*)::int AS customers FROM users u JOIN roles r ON r.id = u.role_id
          WHERE ${CUSTOMER} GROUP BY r.name ORDER BY customers DESC`,
  },
  breeding_trend: {
    kind: 'chart', chart: 'line', label: 'Breeding Records', scope: 'period', roles: ALL,
    xKey: 'period', dataKeys: ['records'],
    sql: `SELECT to_char(date_trunc('{bucket}', created_at), 'YYYY-MM-DD') AS period, COUNT(*)::int AS records
          FROM breeding_records WHERE is_deleted = 0 AND created_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`,
  },

  recent_payments: {
    kind: 'list', label: 'Recent Payments', scope: 'period', roles: SUPER, span: 2, link: '/payments',
    columns: [
      { key: 'customer', label: 'Customer' },
      { key: 'plan', label: 'Plan' },
      { key: 'amount', label: 'Amount', format: 'currency' },
      { key: 'status', label: 'Status', format: 'status' },
      { key: 'created_at', label: 'Date', format: 'datetime' },
    ],
    sql: `SELECT p.id, u.name AS customer, p.plan, p.amount, p.currency, p.status, p.created_at
          FROM payments p JOIN users u ON u.id = p.user_id
          WHERE p.is_deleted = 0 AND p.created_at BETWEEN $1 AND $2
          ORDER BY p.created_at DESC LIMIT 8`,
  },
  recent_farmers: {
    kind: 'list', label: 'Newest Farmers', scope: 'period', roles: SUPER, span: 2, link: '/customers',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'farms', label: 'Farms' },
      { key: 'created_at', label: 'Joined', format: 'datetime' },
    ],
    sql: `SELECT u.id, u.name, u.email, u.created_at,
            (SELECT COUNT(*)::int FROM farms f WHERE f.created_by = u.id AND f.is_deleted = 0) AS farms
          FROM users u WHERE ${CUSTOMER} AND u.created_at BETWEEN $1 AND $2
          ORDER BY u.created_at DESC LIMIT 8`,
  },
};
