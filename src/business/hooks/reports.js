import Joi from 'joi';
import { DatabaseHelper } from '../../config/database.js';
import { ValidationError } from '../../middleware/errors.js';
import { HEALTH_DUE_DATE_SQL } from './health.js';
import { feedingSummary } from './feeding.js';

const GESTATION_DAYS = 114;
const WEANING_DAYS = 56;

const rangeSchema = Joi.object({
  from: Joi.date().iso(),
  to: Joi.date().iso(),
});

const resolveRange = (query, defaultDays) => {
  const { error, value } = rangeSchema.validate(query ?? {}, { stripUnknown: true });
  if (error) throw new ValidationError(error.message);
  const to = value.to ?? new Date(Date.now() + defaultDays * 86_400_000);
  const from = value.from ?? new Date(Date.now() - defaultDays * 86_400_000);
  if (from > to) throw new ValidationError('"from" must be before "to"');
  if ((to - from) / 86_400_000 > 800) throw new ValidationError('The range can be at most two years');
  return { from, to };
};

/**
 * Everything that has a date on the farm, in one list for the calendar:
 * alerts, scheduled/booster health work, matings, due farrowings and weanings.
 */
export const farmCalendar = async (ctx, query) => {
  const { from, to } = resolveRange(query, 120);
  const { rows } = await DatabaseHelper.executeQuery(
    `SELECT * FROM (
       SELECT 'alert-' || a.id AS id, a.alert_start_date::date AS date, a.name AS title, a.message AS details,
         'alert' AS category, a.severity, a.status, a.pig_id
       FROM alerts a
       -- Breeding/birth alerts are already shown as milestones derived from breeding records.
       WHERE a.farm_id = $1 AND a.is_deleted = false AND a.is_active = true
         AND a.alert_type NOT IN ('breeding', 'birth')
         AND a.status <> 'rejected' AND a.alert_start_date::date BETWEEN $2::date AND $3::date
       UNION ALL
       -- One event per treatment and day, so a pen- or herd-wide vaccination is a single entry.
       SELECT 'health-' || MIN(h.id::text), ${HEALTH_DUE_DATE_SQL},
         initcap(h.type) || ': ' || h.description
           || CASE WHEN COUNT(*) > 1 THEN ' (' || COUNT(*) || ' pigs)' ELSE ' · pig ' || MIN(h.pig_id) END,
         MIN(h.veterinarian),
         'health',
         CASE WHEN ${HEALTH_DUE_DATE_SQL} < CURRENT_DATE THEN 'high' ELSE 'medium' END,
         CASE WHEN ${HEALTH_DUE_DATE_SQL} < CURRENT_DATE THEN 'overdue' ELSE 'due' END,
         CASE WHEN COUNT(*) = 1 THEN MIN(h.pig_id) END
       FROM health_records h
       WHERE h.farm_id = $1 AND h.is_deleted = 0 AND h.status <> 'cancelled'
         AND ${HEALTH_DUE_DATE_SQL} BETWEEN $2::date AND $3::date
       GROUP BY ${HEALTH_DUE_DATE_SQL}, h.type, h.description
       UNION ALL
       SELECT 'mating-' || br.id, br.mating_date, 'Mating: sow ' || br.sow_id || ' × boar ' || br.boar_id,
         NULL, 'breeding', 'low', 'done', br.sow_id
       FROM breeding_records br
       WHERE br.farm_id = $1 AND br.is_deleted = 0 AND br.mating_date BETWEEN $2::date AND $3::date
       UNION ALL
       SELECT 'heat-' || br.id, br.mating_date + 21, 'Heat check (21 days): sow ' || br.sow_id,
         'If she shows heat again, the mating did not take', 'breeding', 'medium', 'due', br.sow_id
       FROM breeding_records br
       WHERE br.farm_id = $1 AND br.is_deleted = 0 AND br.actual_birth_date IS NULL
         AND br.mating_date + 21 BETWEEN $2::date AND $3::date
       UNION ALL
       SELECT 'farrow-' || br.id, COALESCE(br.expected_birth_date, br.mating_date + ${GESTATION_DAYS}),
         'Expected farrowing: sow ' || br.sow_id, 'Prepare the farrowing pen a week before',
         'farrowing', 'high', 'due', br.sow_id
       FROM breeding_records br
       WHERE br.farm_id = $1 AND br.is_deleted = 0 AND br.actual_birth_date IS NULL
         AND COALESCE(br.expected_birth_date, br.mating_date + ${GESTATION_DAYS}) BETWEEN $2::date AND $3::date
       UNION ALL
       SELECT 'born-' || br.id, br.actual_birth_date, 'Farrowed: sow ' || br.sow_id || ' (' || COALESCE(br.number_of_piglets, 0) || ' piglets)',
         NULL, 'farrowing', 'low', 'done', br.sow_id
       FROM breeding_records br
       WHERE br.farm_id = $1 AND br.is_deleted = 0 AND br.actual_birth_date BETWEEN $2::date AND $3::date
       UNION ALL
       SELECT 'wean-' || br.id, br.actual_birth_date + ${WEANING_DAYS}, 'Weaning due: litter of sow ' || br.sow_id,
         NULL, 'weaning', 'medium', CASE WHEN br.actual_birth_date + ${WEANING_DAYS} < CURRENT_DATE THEN 'done' ELSE 'due' END, br.sow_id
       FROM breeding_records br
       WHERE br.farm_id = $1 AND br.is_deleted = 0 AND br.actual_birth_date IS NOT NULL
         AND br.actual_birth_date + ${WEANING_DAYS} BETWEEN $2::date AND $3::date
     ) events
     ORDER BY date, category
     LIMIT 3000`,
    [ctx.farmId, from, to]
  );
  return { from: from.toISOString(), to: to.toISOString(), events: rows };
};

/**
 * Farm performance report for a period. All figures are aggregated in PostgreSQL so
 * the response size stays the same whether the farm has 50 pigs or 50,000.
 */
export const farmReport = async (ctx, query) => {
  const { from, to } = resolveRange({ from: query.from, to: query.to ?? new Date().toISOString() }, 180);
  const p = [ctx.farmId, from, to];
  const q = (sql, params = p) => DatabaseHelper.executeQuery(sql, params).then(result => result.rows);
  const [herd, breeds, breeding, piglets, removals, income, incomeByType, health, feed] = await Promise.all([
    q(`SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE gender = 'female')::int AS females,
         COUNT(*) FILTER (WHERE gender = 'male')::int AS males,
         COUNT(*) FILTER (WHERE is_pregnant)::int AS pregnant,
         COUNT(*) FILTER (WHERE CURRENT_DATE - birth_date < 56)::int AS piglets,
         COUNT(*) FILTER (WHERE CURRENT_DATE - birth_date BETWEEN 56 AND 120)::int AS weaners_growers,
         COUNT(*) FILTER (WHERE CURRENT_DATE - birth_date > 120)::int AS adults,
         COUNT(*) FILTER (WHERE status IN ('sick', 'quarantine'))::int AS sick,
         COUNT(*) FILTER (WHERE created_at BETWEEN $2 AND $3)::int AS added
       FROM pigs WHERE farm_id = $1 AND is_deleted = 0`),
    q(`SELECT breed, COUNT(*)::int AS pigs FROM pigs WHERE farm_id = $1 AND is_deleted = 0
       GROUP BY breed ORDER BY pigs DESC LIMIT 8`, [ctx.farmId]),
    q(`SELECT COUNT(*) FILTER (WHERE mating_date BETWEEN $2 AND $3)::int AS matings,
         COUNT(*) FILTER (WHERE actual_birth_date BETWEEN $2 AND $3)::int AS farrowings,
         COALESCE(SUM(number_of_piglets) FILTER (WHERE actual_birth_date BETWEEN $2 AND $3), 0)::int AS piglets_born,
         ROUND(AVG(number_of_piglets) FILTER (WHERE actual_birth_date BETWEEN $2 AND $3), 1)::float AS avg_litter_size,
         COUNT(*) FILTER (WHERE actual_birth_date IS NULL AND mating_date > CURRENT_DATE - ${GESTATION_DAYS} - 7)::int AS due_to_farrow
       FROM breeding_records WHERE farm_id = $1 AND is_deleted = 0`),
    q(`SELECT COUNT(*) FILTER (WHERE k.status = 'dead')::int AS died, COUNT(*)::int AS recorded
       FROM piglet_records k JOIN breeding_records br ON br.id = k.breeding_record_id
       WHERE k.farm_id = $1 AND k.is_deleted = 0 AND br.actual_birth_date BETWEEN $2 AND $3`),
    q(`SELECT reason, COUNT(*)::int AS pigs, COALESCE(SUM(sale_amount), 0)::float AS sale_amount
       FROM removal_records WHERE farm_id = $1 AND is_deleted = 0 AND date BETWEEN $2 AND $3
       GROUP BY reason ORDER BY pigs DESC`),
    q(`SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS month, SUM(amount)::float AS income
       FROM earnings_records WHERE farm_id = $1 AND is_deleted = 0 AND date BETWEEN $2 AND $3
       GROUP BY 1 ORDER BY 1`),
    q(`SELECT type, COUNT(*)::int AS records, SUM(amount)::float AS amount
       FROM earnings_records WHERE farm_id = $1 AND is_deleted = 0 AND date BETWEEN $2 AND $3
       GROUP BY type ORDER BY amount DESC`),
    q(`SELECT type, COUNT(*)::int AS records, COUNT(DISTINCT pig_id)::int AS pigs
       FROM health_records WHERE farm_id = $1 AND is_deleted = 0 AND status = 'completed' AND date BETWEEN $2 AND $3
       GROUP BY type ORDER BY records DESC`),
    feedingSummary(ctx, { from, to }),
  ]);

  const deaths = removals.filter(row => row.reason.startsWith('death')).reduce((sum, row) => sum + row.pigs, 0);
  const sold = removals.find(row => row.reason === 'sale');
  const totalIncome = incomeByType.reduce((sum, row) => sum + row.amount, 0);
  const pigletsBorn = breeding[0].piglets_born;
  const feedByMonth = Object.fromEntries(feed.by_month.map(row => [row.month, row.kg]));
  const months = [...new Set([...income.map(row => row.month), ...feed.by_month.map(row => row.month)])].sort();

  return {
    currency: feed.currency,
    from: from.toISOString(),
    to: to.toISOString(),
    herd: herd[0],
    breeds,
    breeding: {
      ...breeding[0],
      piglet_deaths: piglets[0].died,
      pre_weaning_mortality_pct: pigletsBorn ? Math.round((piglets[0].died / pigletsBorn) * 1000) / 10 : null,
    },
    removals,
    sales: { pigs_sold: sold?.pigs ?? 0, sale_value: sold?.sale_amount ?? 0 },
    mortality: {
      deaths,
      rate_pct: herd[0].total + deaths ? Math.round((deaths / (herd[0].total + deaths)) * 1000) / 10 : 0,
    },
    finance: {
      income: totalIncome,
      feed_cost: feed.estimated_cost,
      margin_over_feed: Math.round(totalIncome - feed.estimated_cost),
      by_type: incomeByType,
    },
    feed: { total_kg: feed.total_kg, kg_per_pig_per_day: feed.kg_per_pig_per_day, by_feed_type: feed.by_feed_type },
    health,
    monthly: months.map(month => ({
      month,
      income: income.find(row => row.month === month)?.income ?? 0,
      feed_kg: feedByMonth[month] ?? 0,
    })),
  };
};
