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
 * permission       -> the admin permission needed to see the widget (aggregates need dashboard.read;
 *                     money needs payments.read; lists of named farmers need customers.read)
 * minCohort        -> without customers.read, rows covering fewer than N farms are suppressed
 * compare          -> stats also return `previous`: the same figure for the period just before
 * series           -> chart series, each drawn as bar/line/area, optionally on the right axis
 */
const ALL = 'dashboard.read';
const MONEY = 'payments.read';
const PEOPLE = 'customers.read';
const CUSTOMER = 'u.is_deleted = 0 AND u.admin_role_id IS NULL';
// Every bucket in the range, so charts show zero-activity days/weeks/months instead of skipping them.
const SERIES = `WITH series AS (
  SELECT generate_series(date_trunc('{bucket}', $1::timestamptz), $2::timestamptz, '1 {bucket}'::interval) AS bucket)`;
const PERIOD = "to_char(s.bucket, 'YYYY-MM-DD')";
/** Count of `table` rows per bucket of `column` (zero-filled). */
const countPerBucket = (table, column, where = 'TRUE') =>
  `(SELECT COUNT(*)::int FROM ${table} t WHERE ${where} AND t.${column} >= s.bucket AND t.${column} < s.bucket + '1 {bucket}'::interval)`;

export const dashboardWidgets = {
  total_farmers: {
    kind: 'stat', label: 'Total Farmers', icon: 'users', tone: 'indigo', scope: 'snapshot', permission: ALL,
    sql: `SELECT COUNT(*)::int AS value FROM users u WHERE ${CUSTOMER}`,
  },
  new_farmers: {
    kind: 'stat', label: 'New Farmers', icon: 'user-plus', tone: 'emerald', scope: 'period', permission: ALL, compare: true,
    sql: `SELECT COUNT(*)::int AS value FROM users u WHERE ${CUSTOMER} AND u.created_at BETWEEN $1 AND $2`,
  },
  active_farmers: {
    kind: 'stat', label: 'Active Farmers', icon: 'activity', tone: 'sky', scope: 'period', permission: ALL, compare: true,
    sql: `SELECT COUNT(*)::int AS value FROM users u WHERE ${CUSTOMER} AND u.last_login BETWEEN $1 AND $2`,
  },
  total_farms: {
    kind: 'stat', label: 'Total Farms', icon: 'warehouse', tone: 'amber', scope: 'snapshot', permission: ALL,
    sql: 'SELECT COUNT(*)::int AS value FROM farms WHERE is_deleted = 0',
  },
  total_pigs: {
    kind: 'stat', label: 'Pigs Recorded', icon: 'piggy-bank', tone: 'pink', scope: 'snapshot', permission: ALL,
    sql: 'SELECT COUNT(*)::int AS value FROM pigs WHERE is_deleted = 0',
  },
  farms_recording: {
    kind: 'stat', label: 'Farms Recording Data', icon: 'activity', tone: 'violet', scope: 'period', permission: ALL, compare: true,
    hint: 'Farms that logged health, feeding, breeding or sales',
    sql: `SELECT COUNT(DISTINCT farm_id)::int AS value FROM (
            SELECT farm_id FROM health_records WHERE created_at BETWEEN $1 AND $2
            UNION ALL SELECT farm_id FROM feeding_records WHERE created_at BETWEEN $1 AND $2
            UNION ALL SELECT farm_id FROM breeding_records WHERE created_at BETWEEN $1 AND $2
            UNION ALL SELECT farm_id FROM earnings_records WHERE created_at BETWEEN $1 AND $2) active`,
  },
  paying_share: {
    kind: 'stat', label: 'Paying Farmers', icon: 'badge-check', tone: 'emerald', scope: 'snapshot', permission: ALL, format: 'percent',
    hint: 'Share of farmers with an active paid plan',
    sql: `SELECT COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE u.subscription_end > CURRENT_TIMESTAMP) / NULLIF(COUNT(*), 0), 1), 0)::float AS value
          FROM users u WHERE ${CUSTOMER}`,
  },
  churned: {
    kind: 'stat', label: 'Plans Lapsed', icon: 'user-minus', tone: 'pink', scope: 'period', permission: MONEY, compare: true,
    hint: 'Paid plans that ended without renewal',
    sql: `SELECT COUNT(*)::int AS value FROM subscriptions s
          WHERE s.status = 'expired' AND s.current_plan <> 'trial' AND s.expiry_date BETWEEN $1 AND $2
            AND NOT EXISTS (SELECT 1 FROM subscriptions n WHERE n.user_id = s.user_id AND n.status = 'active' AND n.created_at > s.created_at)`,
  },
  revenue: {
    kind: 'stat', label: 'Revenue (KES)', icon: 'banknote', tone: 'emerald', scope: 'period', permission: MONEY, format: 'currency', compare: true,
    sql: `SELECT COALESCE(SUM(amount), 0)::numeric AS value FROM payments
          WHERE status = 'success' AND currency = 'KES' AND is_deleted = 0 AND completed_at BETWEEN $1 AND $2`,
  },
  payments: {
    kind: 'breakdown', label: 'Payments', icon: 'credit-card', tone: 'violet', scope: 'period', permission: MONEY,
    breakdown: ['success', 'pending', 'failed'],
    sql: `SELECT COUNT(*)::int AS value,
            COUNT(*) FILTER (WHERE status = 'success')::int AS success,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status IN ('failed', 'cancelled'))::int AS failed
          FROM payments WHERE is_deleted = 0 AND created_at BETWEEN $1 AND $2`,
  },
  subscriptions: {
    kind: 'breakdown', label: 'Subscriptions', icon: 'badge-check', tone: 'sky', scope: 'snapshot', permission: ALL,
    breakdown: ['active', 'trial', 'expired'],
    sql: `SELECT COUNT(*)::int AS value,
            COUNT(*) FILTER (WHERE status = 'active')::int AS active,
            COUNT(*) FILTER (WHERE status = 'trial')::int AS trial,
            COUNT(*) FILTER (WHERE status = 'expired')::int AS expired
          FROM (SELECT DISTINCT ON (user_id) status FROM subscriptions WHERE is_active = 1
                ORDER BY user_id, created_at DESC) latest`,
  },

  signup_trend: {
    kind: 'chart', chart: 'bar', label: 'Farmer Growth', scope: 'period', permission: ALL, span: 2,
    xKey: 'period',
    series: [
      { key: 'signups', label: 'New farmers', kind: 'bar' },
      { key: 'total_farmers', label: 'Total farmers', kind: 'line', axis: 'right' },
    ],
    sql: `${SERIES}
          SELECT ${PERIOD} AS period,
            ${countPerBucket('users', 'created_at', 't.is_deleted = 0 AND t.admin_role_id IS NULL')} AS signups,
            (SELECT COUNT(*)::int FROM users t WHERE t.is_deleted = 0 AND t.admin_role_id IS NULL
               AND t.created_at < s.bucket + '1 {bucket}'::interval) AS total_farmers
          FROM series s ORDER BY s.bucket`,
  },
  revenue_trend: {
    kind: 'chart', chart: 'bar', label: 'Revenue (KES)', scope: 'period', permission: MONEY, span: 2,
    xKey: 'period', dataKeys: ['revenue'],
    sql: `${SERIES}
          SELECT ${PERIOD} AS period,
            (SELECT COALESCE(SUM(t.amount), 0)::float FROM payments t
             WHERE t.status = 'success' AND t.currency = 'KES' AND t.is_deleted = 0
               AND t.completed_at >= s.bucket AND t.completed_at < s.bucket + '1 {bucket}'::interval) AS revenue
          FROM series s ORDER BY s.bucket`,
  },
  usage_trend: {
    kind: 'chart', chart: 'line', label: 'Records Logged by Farmers', scope: 'period', permission: ALL, span: 2,
    xKey: 'period',
    series: [
      { key: 'health', label: 'Health', kind: 'line' },
      { key: 'feeding', label: 'Feeding', kind: 'line' },
      { key: 'breeding', label: 'Breeding', kind: 'line' },
      { key: 'sales', label: 'Sales', kind: 'line' },
    ],
    sql: `${SERIES}
          SELECT ${PERIOD} AS period,
            ${countPerBucket('health_records', 'created_at', 't.is_deleted = 0')} AS health,
            ${countPerBucket('feeding_records', 'created_at', 't.is_deleted = 0')} AS feeding,
            ${countPerBucket('breeding_records', 'created_at', 't.is_deleted = 0')} AS breeding,
            ${countPerBucket('earnings_records', 'created_at', 't.is_deleted = 0')} AS sales
          FROM series s ORDER BY s.bucket`,
  },
  breeds: {
    kind: 'chart', chart: 'bar', orientation: 'horizontal', label: 'Top Breeds', scope: 'snapshot', permission: ALL,
    xKey: 'breed', dataKeys: ['pigs'], minCohort: 5,
    sql: `SELECT breed, COUNT(*)::int AS pigs, COUNT(DISTINCT farm_id)::int AS farms
          FROM pigs WHERE is_deleted = 0 GROUP BY breed ORDER BY pigs DESC LIMIT 10`,
  },
  gender: {
    kind: 'chart', chart: 'donut', label: 'Herd by Gender', scope: 'snapshot', permission: ALL,
    nameKey: 'gender', valueKey: 'pigs', minCohort: 5,
    sql: `SELECT gender, COUNT(*)::int AS pigs, COUNT(DISTINCT farm_id)::int AS farms
          FROM pigs WHERE is_deleted = 0 GROUP BY gender ORDER BY gender`,
  },
  plans: {
    kind: 'chart', chart: 'donut', label: 'Farmers by Plan', scope: 'snapshot', permission: ALL,
    nameKey: 'plan', valueKey: 'customers',
    sql: `SELECT CASE WHEN u.subscription_end > CURRENT_TIMESTAMP THEN initcap(COALESCE(latest.current_plan, 'paid'))
                      WHEN latest.status = 'trial' AND latest.trial_end_date > CURRENT_TIMESTAMP THEN 'Trial'
                      ELSE 'Free' END AS plan,
            COUNT(*)::int AS customers
          FROM users u
          LEFT JOIN LATERAL (SELECT s.current_plan, s.status, s.trial_end_date FROM subscriptions s
                             WHERE s.user_id = u.id AND s.is_active = 1 ORDER BY s.created_at DESC LIMIT 1) latest ON TRUE
          WHERE ${CUSTOMER} GROUP BY 1 ORDER BY customers DESC`,
  },
  locations: {
    kind: 'chart', chart: 'bar', orientation: 'horizontal', label: 'Top Farm Locations', scope: 'snapshot', permission: ALL,
    xKey: 'location', dataKeys: ['farm_count'], minCohort: 2,
    // `farms` drives the small-group privacy filter and is removed from the response.
    sql: `SELECT COALESCE(NULLIF(initcap(trim(split_part(location, ',', 1))), ''), 'Not set') AS location,
            COUNT(*)::int AS farm_count, COUNT(*)::int AS farms
          FROM farms WHERE is_deleted = 0 GROUP BY 1 ORDER BY farms DESC LIMIT 10`,
  },
  recent_payments: {
    kind: 'list', label: 'Recent Payments', scope: 'period', permission: MONEY, span: 2, link: '/payments',
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
    kind: 'list', label: 'Newest Farmers', scope: 'period', permission: PEOPLE, span: 2, link: '/customers',
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
