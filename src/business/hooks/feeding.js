import Joi from 'joi';
import { DatabaseHelper } from '../../config/database.js';
import { ValidationError } from '../../middleware/errors.js';

const livePigsInPen = async (client, farmId, penId) => {
  const { rows } = await client.query(
    `SELECT COALESCE(jsonb_agg(pig_id ORDER BY pig_id), '[]'::jsonb) AS pigs, COUNT(*)::int AS count
     FROM pigs WHERE farm_id = $1 AND pen_id = $2 AND is_deleted = 0`,
    [farmId, penId]
  );
  return rows[0];
};

export const feedingRecordHooks = {
  async beforeCreate(ctx, data) {
    data.fed_by = ctx.user.id;
    if (data.record_type === 'daily') {
      if (!data.pig_id && !data.pen_id) throw new ValidationError('A daily feeding record needs a pig or a pen');
      data.pigs_count = 1;
      data.feeding_time ??= new Date();
      if (data.pen_id) {
        const pen = await livePigsInPen(ctx.client, ctx.farmId, data.pen_id);
        if (pen.count === 0) throw new ValidationError('Cannot record feeding for a pen with no pigs');
        data.pigs_count = pen.count;
      }
      return;
    }
    // Weekly or monthly totals are recorded per pen.
    if (!data.pen_id) throw new ValidationError('Weekly and monthly feeding records need a pen');
    if (!data.start_date || !data.end_date || data.total_amount === undefined) {
      throw new ValidationError('Weekly and monthly feeding records need start_date, end_date and total_amount');
    }
    if (new Date(data.end_date) < new Date(data.start_date)) throw new ValidationError('end_date must be after start_date');
    const pen = await livePigsInPen(ctx.client, ctx.farmId, data.pen_id);
    if (pen.count === 0) throw new ValidationError('Cannot record feeding for a pen with no pigs');
    data.pigs_in_pen = pen.pigs;
    data.pigs_count = pen.count;
    data.amount = String(data.total_amount);
    data.feeding_time = data.start_date;
  },
};

/*
 * Starting-point daily rations by production stage (kg of feed per pig per day) and the
 * commercial feed usually given at that stage in Kenya. Farms can override any stage in
 * farms.settings.feed_guide; confirm amounts with your feed supplier or nutritionist.
 */
export const DEFAULT_FEED_GUIDE = {
  piglet: { label: 'Piglet (under 8 weeks)', feed_type: 'Creep pellets', kg_per_day: 0.3 },
  weaner: { label: 'Weaner (8-12 weeks)', feed_type: 'Starter meal', kg_per_day: 1.0 },
  grower: { label: 'Grower (3-4 months)', feed_type: 'Pig grower meal', kg_per_day: 1.8 },
  finisher: { label: 'Finisher (4-8 months)', feed_type: 'Pig finisher meal', kg_per_day: 2.5 },
  dry_sow: { label: 'Dry sow / gilt', feed_type: 'Sow & weaner meal', kg_per_day: 2.5 },
  pregnant_sow: { label: 'Pregnant sow', feed_type: 'Gestator meal', kg_per_day: 2.5 },
  lactating_sow: { label: 'Lactating sow', feed_type: 'Lactator meal', kg_per_day: 5.0 },
  boar: { label: 'Breeding boar', feed_type: 'Sow & weaner meal', kg_per_day: 2.5 },
};

export const FEED_TYPES = [
  'Creep pellets', 'Starter meal', 'Sow & weaner meal', 'Gestator meal', 'Lactator meal',
  'Pig grower meal', 'Pig finisher meal', 'Maize germ', 'Wheat bran', 'Kitchen waste', 'Other',
];

// Classifies each live pig into a feeding stage from age, sex, pregnancy and recent farrowing.
const STAGE_SQL = `
  CASE
    WHEN p.gender = 'female' AND EXISTS (
      SELECT 1 FROM breeding_records br WHERE br.farm_id = p.farm_id AND br.sow_id = p.pig_id
        AND br.is_deleted = 0 AND br.actual_birth_date >= CURRENT_DATE - 56) THEN 'lactating_sow'
    WHEN p.is_pregnant THEN 'pregnant_sow'
    WHEN CURRENT_DATE - p.birth_date < 56 THEN 'piglet'
    WHEN CURRENT_DATE - p.birth_date < 85 THEN 'weaner'
    WHEN CURRENT_DATE - p.birth_date < 121 THEN 'grower'
    WHEN CURRENT_DATE - p.birth_date >= 240 AND p.gender = 'male' THEN 'boar'
    WHEN CURRENT_DATE - p.birth_date >= 240 AND p.gender = 'female' THEN 'dry_sow'
    ELSE 'finisher'
  END`;

/** Feed quantity in kg for any record, whatever unit or record type it was entered with. */
export const FEED_KG_SQL = `(
  CASE WHEN fr.record_type IN ('weekly', 'monthly') AND fr.total_amount IS NOT NULL THEN fr.total_amount
       WHEN fr.amount ~ '^[0-9]+(\\.[0-9]+)?$' THEN fr.amount::numeric
       ELSE 0 END
  * CASE fr.unit WHEN 'grams' THEN 0.001 WHEN 'lbs' THEN 0.4536 ELSE 1 END)`;

const STOCK_KG_SQL = `(fi.quantity * CASE fi.unit WHEN 'bag_70kg' THEN 70 WHEN 'bag_50kg' THEN 50 WHEN 'bag_25kg' THEN 25 WHEN 'tonne' THEN 1000 ELSE 1 END)`;

const farmGuide = async (client, farmId) => {
  const { rows } = await client.query("SELECT settings->'feed_guide' AS guide FROM farms WHERE id = $1", [farmId]);
  const overrides = rows[0]?.guide ?? {};
  return Object.fromEntries(Object.entries(DEFAULT_FEED_GUIDE).map(([stage, value]) => [stage, { ...value, ...(overrides[stage] ?? {}) }]));
};

/** Today's feeding sheet: every occupied pen with a suggested ration and what was already given today. */
export const feedingPlan = async ctx => {
  const guide = await farmGuide({ query: (sql, params) => DatabaseHelper.executeQuery(sql, params) }, ctx.farmId);
  const { rows } = await DatabaseHelper.executeQuery(
    `SELECT pn.id AS pen_id, pn.name AS pen_name, rw.name AS row_name,
       stages.stage_counts,
       (SELECT COALESCE(SUM(${FEED_KG_SQL}), 0) FROM feeding_records fr
         WHERE fr.farm_id = pn.farm_id AND fr.pen_id = pn.id AND fr.is_deleted = 0
           AND fr.record_type = 'daily' AND (fr.feeding_time AT TIME ZONE 'Africa/Nairobi')::date = (now() AT TIME ZONE 'Africa/Nairobi')::date
       )::float AS fed_today_kg
     FROM pens pn
     LEFT JOIN rows rw ON rw.id = pn.row_id
     JOIN LATERAL (
       SELECT jsonb_object_agg(stage, n) AS stage_counts FROM (
         SELECT ${STAGE_SQL} AS stage, COUNT(*)::int AS n FROM pigs p
         WHERE p.farm_id = pn.farm_id AND p.pen_id = pn.id AND p.is_deleted = 0 GROUP BY 1
       ) s
     ) stages ON stages.stage_counts IS NOT NULL
     WHERE pn.farm_id = $1 AND pn.is_deleted = 0
     ORDER BY rw.name NULLS LAST, pn.level, pn.position`,
    [ctx.farmId]
  );
  const pens = rows.map(row => {
    const byType = {};
    let suggested = 0;
    for (const [stage, count] of Object.entries(row.stage_counts)) {
      const kg = count * Number(guide[stage].kg_per_day);
      suggested += kg;
      byType[guide[stage].feed_type] = (byType[guide[stage].feed_type] ?? 0) + kg;
    }
    const feedType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] ?? FEED_TYPES[1];
    return {
      pen_id: row.pen_id,
      pen_name: row.pen_name,
      row_name: row.row_name,
      pigs: Object.values(row.stage_counts).reduce((sum, n) => sum + n, 0),
      stages: row.stage_counts,
      feed_type: feedType,
      suggested_kg: Math.round(suggested * 10) / 10,
      fed_today_kg: row.fed_today_kg,
    };
  });
  return { guide, feed_types: FEED_TYPES, pens };
};

const batchSchema = Joi.object({
  feeding_time: Joi.date().iso().max('now').default(() => new Date()),
  entries: Joi.array().min(1).max(2000).items(Joi.object({
    pen_id: Joi.string().guid().required(),
    feed_type: Joi.string().trim().max(50).required(),
    amount_kg: Joi.number().positive().max(10_000).required(),
    notes: Joi.string().trim().max(1000).allow('', null),
  })).required(),
});

/** Records one feeding for many pens in a single save (the daily feeding round). */
export const recordFeedingRound = async (ctx, service, body) => {
  const { error, value } = batchSchema.validate(body ?? {}, { abortEarly: false, stripUnknown: true });
  if (error) throw new ValidationError(`Validation error: ${error.details.map(item => item.message).join(', ')}`);
  return service.runInTransaction(async client => {
    const { rows } = await client.query(
      `INSERT INTO feeding_records (farm_id, pen_id, feed_type, amount, unit, feeding_time, record_type, pigs_count, pigs_in_pen, fed_by, notes)
       SELECT $1, e.pen_id, e.feed_type, e.amount::text, 'kg', $2, 'daily',
         (SELECT COUNT(*) FROM pigs p WHERE p.farm_id = $1 AND p.pen_id = e.pen_id AND p.is_deleted = 0),
         (SELECT COALESCE(jsonb_agg(p.pig_id), '[]') FROM pigs p WHERE p.farm_id = $1 AND p.pen_id = e.pen_id AND p.is_deleted = 0),
         $3, NULLIF(e.notes, '')
       FROM unnest($4::uuid[], $5::text[], $6::numeric[], $7::text[]) AS e(pen_id, feed_type, amount, notes)
       JOIN pens pn ON pn.id = e.pen_id AND pn.farm_id = $1 AND pn.is_deleted = 0
       RETURNING id`,
      [ctx.farmId, value.feeding_time, ctx.user.id,
        value.entries.map(e => e.pen_id), value.entries.map(e => e.feed_type),
        value.entries.map(e => e.amount_kg), value.entries.map(e => e.notes ?? '')]
    );
    if (rows.length !== value.entries.length) throw new ValidationError('One or more pens were not found on this farm');
    await service.audit(ctx, client, 'feeding_round', 'batch', null, { pens: rows.length });
    return { created: rows.length };
  });
};

/** Feed used, bought, cost and stock on hand for a period. */
export const feedingSummary = async (ctx, query) => {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86_400_000);
  const params = [ctx.farmId, from, to];
  const [usage, monthly, stock, pigDays] = await Promise.all([
    DatabaseHelper.executeQuery(
      `SELECT fr.feed_type, ROUND(SUM(${FEED_KG_SQL}), 1)::float AS kg
       FROM feeding_records fr WHERE fr.farm_id = $1 AND fr.is_deleted = 0 AND fr.feeding_time BETWEEN $2 AND $3
       GROUP BY 1 ORDER BY kg DESC`, params),
    DatabaseHelper.executeQuery(
      `SELECT to_char(date_trunc('month', fr.feeding_time), 'YYYY-MM') AS month, ROUND(SUM(${FEED_KG_SQL}), 1)::float AS kg
       FROM feeding_records fr WHERE fr.farm_id = $1 AND fr.is_deleted = 0 AND fr.feeding_time BETWEEN $2 AND $3
       GROUP BY 1 ORDER BY 1`, params),
    DatabaseHelper.executeQuery(
      `WITH bought AS (
         SELECT lower(trim(fi.feed_type)) AS key, MIN(fi.feed_type) AS feed_type, SUM(${STOCK_KG_SQL}) AS kg,
           SUM(fi.quantity * COALESCE(fi.cost_per_unit, 0)) AS cost
         FROM feed_inventory fi WHERE fi.farm_id = $1 AND fi.is_deleted = 0 GROUP BY 1),
       used AS (
         SELECT lower(trim(fr.feed_type)) AS key, SUM(${FEED_KG_SQL}) AS kg
         FROM feeding_records fr WHERE fr.farm_id = $1 AND fr.is_deleted = 0 GROUP BY 1)
       SELECT b.feed_type, ROUND(b.kg, 1)::float AS bought_kg, ROUND(COALESCE(u.kg, 0), 1)::float AS used_kg,
         ROUND(b.kg - COALESCE(u.kg, 0), 1)::float AS on_hand_kg,
         CASE WHEN b.kg > 0 THEN ROUND(b.cost / b.kg, 2)::float END AS cost_per_kg
       FROM bought b LEFT JOIN used u ON u.key = b.key ORDER BY b.feed_type`, [ctx.farmId]),
    DatabaseHelper.executeQuery(
      `SELECT COUNT(*)::int AS pigs, (SELECT currency FROM farms WHERE id = $1) AS currency
       FROM pigs WHERE farm_id = $1 AND is_deleted = 0`, [ctx.farmId]),
  ]);
  const costPerKg = Object.fromEntries(stock.rows.map(row => [row.feed_type.toLowerCase().trim(), row.cost_per_kg]));
  const totalKg = usage.rows.reduce((sum, row) => sum + row.kg, 0);
  const estimatedCost = usage.rows.reduce((sum, row) => sum + row.kg * (costPerKg[row.feed_type.toLowerCase().trim()] ?? 0), 0);
  const days = Math.max(1, Math.round((to - from) / 86_400_000));
  return {
    // Money values are in the farm's currency (feed prices are entered in it).
    currency: pigDays.rows[0].currency ?? 'KES',
    from: from.toISOString(),
    to: to.toISOString(),
    total_kg: Math.round(totalKg * 10) / 10,
    estimated_cost: Math.round(estimatedCost),
    kg_per_pig_per_day: pigDays.rows[0].pigs ? Math.round((totalKg / pigDays.rows[0].pigs / days) * 100) / 100 : 0,
    by_feed_type: usage.rows,
    by_month: monthly.rows,
    stock: stock.rows,
  };
};
