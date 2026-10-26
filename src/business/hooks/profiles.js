import { DatabaseHelper } from '../../config/database.js';
import { assertUuid, notFound } from '../helpers.js';
import { FEED_KG_SQL } from './feeding.js';
import { HEALTH_DUE_DATE_SQL } from './health.js';

const HISTORY_LIMIT = 200;
const q = (sql, params) => DatabaseHelper.executeQuery(sql, params).then(result => result.rows);

/**
 * Everything about one pig for its profile page: details, health, the feeding of the
 * pens it lived in (with its share per feed), breeding and litters, moves, exit and sales.
 */
export const pigProfile = async (ctx, service, id) => {
  const pig = await service.getById(ctx, id);
  const params = [ctx.farmId, pig.pig_id];
  const [health, feeding, breeding, movements, transfers, removal, earnings, totals] = await Promise.all([
    q(`SELECT h.id, h.type, h.description, h.date, h.next_due, h.status, h.veterinarian, h.notes,
              ${HEALTH_DUE_DATE_SQL} AS due_date
       FROM health_records h WHERE h.farm_id = $1 AND h.pig_id = $2 AND h.is_deleted = 0
       ORDER BY h.date DESC LIMIT ${HISTORY_LIMIT}`, params),
    // Feeding is recorded per pen, so a pig's feeding is that of the pens it was in while it was there.
    q(`SELECT fr.id, fr.feeding_time, fr.feed_type, fr.record_type, fr.notes, pn.name AS pen_name,
              ROUND(${FEED_KG_SQL}, 2)::float AS kg,
              GREATEST(COALESCE(fr.pigs_count, 1), 1) AS pigs_count,
              ROUND(${FEED_KG_SQL} / GREATEST(COALESCE(fr.pigs_count, 1), 1), 2)::float AS kg_per_pig
       FROM feeding_records fr
       LEFT JOIN pens pn ON pn.id = fr.pen_id
       WHERE fr.farm_id = $1 AND fr.is_deleted = 0 AND (
         fr.pig_id = $2 OR EXISTS (
           SELECT 1 FROM pen_pig_history ph
           WHERE ph.farm_id = fr.farm_id AND ph.pig_id = $2 AND ph.pen_id = fr.pen_id AND ph.is_deleted = 0
             AND fr.feeding_time >= ph.assigned_at AND (ph.removed_at IS NULL OR fr.feeding_time <= ph.removed_at)))
       ORDER BY fr.feeding_time DESC LIMIT ${HISTORY_LIMIT}`, params),
    q(`SELECT br.id, br.sow_id, br.boar_id, br.mating_date, br.expected_birth_date, br.actual_birth_date,
              br.number_of_piglets, br.notes,
              (SELECT COUNT(*)::int FROM piglet_records k WHERE k.breeding_record_id = br.id AND k.is_deleted = 0 AND k.status = 'dead') AS piglets_died
       FROM breeding_records br
       WHERE br.farm_id = $1 AND (br.sow_id = $2 OR br.boar_id = $2) AND br.is_deleted = 0
       ORDER BY br.mating_date DESC LIMIT ${HISTORY_LIMIT}`, params),
    q(`SELECT ph.id, ph.assigned_at, ph.removed_at, ph.removal_reason, ph.removal_notes, pn.name AS pen_name, rw.name AS row_name
       FROM pen_pig_history ph
       LEFT JOIN pens pn ON pn.id = ph.pen_id LEFT JOIN rows rw ON rw.id = pn.row_id
       WHERE ph.farm_id = $1 AND ph.pig_id = $2 AND ph.is_deleted = 0
       ORDER BY ph.assigned_at DESC LIMIT ${HISTORY_LIMIT}`, params),
    q(`SELECT pt.id, pt.transferred_at, pt.transfer_reason, pt.transfer_notes, op.name AS from_pen, np.name AS to_pen, u.name AS transferred_by
       FROM pig_transfer_history pt
       LEFT JOIN pens op ON op.id = pt.old_pen_id LEFT JOIN pens np ON np.id = pt.new_pen_id
       LEFT JOIN users u ON u.id = pt.transferred_by
       WHERE pt.farm_id = $1 AND pt.pig_id = $2 AND pt.is_deleted = 0
       ORDER BY pt.transferred_at DESC LIMIT ${HISTORY_LIMIT}`, params),
    q(`SELECT rr.id, rr.reason, rr.notes, rr.date, rr.sale_amount, rr.sale_weight, rr.sold_to, pn.name AS pen_name
       FROM removal_records rr LEFT JOIN pens pn ON pn.id = rr.pen_id
       WHERE rr.farm_id = $1 AND rr.pig_id = $2 AND rr.is_deleted = 0
       ORDER BY rr.date DESC LIMIT 1`, params),
    q(`SELECT er.id, er.type, er.amount, er.date, er.buyer_name, er.sale_type, er.weight, er.notes
       FROM earnings_records er WHERE er.farm_id = $1 AND er.pig_id = $2 AND er.is_deleted = 0
       ORDER BY er.date DESC LIMIT 50`, params),
    q(`SELECT (SELECT currency FROM farms WHERE id = $1) AS currency`, [ctx.farmId]),
  ]);

  const feed30 = feeding
    .filter(row => new Date(row.feeding_time).getTime() >= Date.now() - 30 * 86_400_000)
    .reduce((sum, row) => sum + row.kg_per_pig, 0);
  const nextDue = health
    .filter(row => row.due_date && row.status !== 'cancelled')
    .map(row => row.due_date)
    .sort((a, b) => new Date(a) - new Date(b))[0] ?? null;

  return {
    pig,
    currency: totals[0]?.currency ?? 'KES',
    summary: {
      age_days: pig.birth_date ? Math.floor((Date.now() - new Date(pig.birth_date).getTime()) / 86_400_000) : null,
      treatments: health.filter(row => row.status === 'completed').length,
      next_health_due: nextDue,
      feed_kg_30d: Math.round(feed30 * 10) / 10,
      litters: breeding.filter(row => row.actual_birth_date).length,
      piglets_born: breeding.reduce((sum, row) => sum + (row.number_of_piglets ?? 0), 0),
      moves: transfers.length,
      income: earnings.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    },
    health,
    feeding,
    breeding,
    movements,
    transfers,
    removal: removal[0] ?? null,
    earnings,
  };
};

/** A pen with the pigs in it now and everyone who has been in it before. */
export const penProfile = async (ctx, id) => {
  assertUuid(id);
  const [pen] = await q(
    `SELECT pn.id, pn.name, pn.level, pn.position, pn.size, pn.material, pn.features, pn.is_occupied, rw.name AS row_name, rw.id AS row_id
     FROM pens pn LEFT JOIN rows rw ON rw.id = pn.row_id
     WHERE pn.id = $1 AND pn.farm_id = $2 AND pn.is_deleted = 0`,
    [id, ctx.farmId]
  );
  if (!pen) throw notFound({ label: 'Pen' });
  const params = [ctx.farmId, id];
  const [pigs, history, feeding] = await Promise.all([
    q(`SELECT p.id, p.pig_id, p.name, p.gender, p.breed, p.color, p.birth_date, p.weight, p.status, p.is_pregnant,
              p.expected_birth_date, p.total_litters,
              (SELECT MAX(ph.assigned_at) FROM pen_pig_history ph WHERE ph.farm_id = p.farm_id AND ph.pig_id = p.pig_id AND ph.pen_id = p.pen_id) AS in_pen_since
       FROM pigs p WHERE p.farm_id = $1 AND p.pen_id = $2 AND p.is_deleted = 0
       ORDER BY p.gender, p.pig_id`, params),
    q(`SELECT ph.id, ph.pig_id, p.id AS pig_uuid, p.name AS pig_name, p.gender, ph.assigned_at, ph.removed_at,
              ph.removal_reason, ph.removal_notes, ph.sale_amount
       FROM pen_pig_history ph
       LEFT JOIN pigs p ON p.farm_id = ph.farm_id AND p.pig_id = ph.pig_id
       WHERE ph.farm_id = $1 AND ph.pen_id = $2 AND ph.is_deleted = 0
       ORDER BY COALESCE(ph.removed_at, ph.assigned_at) DESC LIMIT ${HISTORY_LIMIT}`, params),
    q(`SELECT COUNT(*)::int AS feeds, ROUND(COALESCE(SUM(${FEED_KG_SQL}), 0), 1)::float AS kg, MAX(fr.feeding_time) AS last_fed
       FROM feeding_records fr
       WHERE fr.farm_id = $1 AND fr.pen_id = $2 AND fr.is_deleted = 0 AND fr.feeding_time >= CURRENT_DATE - 30`, params),
  ]);
  return {
    pen,
    pigs,
    history,
    feeding_30d: feeding[0],
    counts: {
      pigs: pigs.length,
      sows: pigs.filter(pig => pig.gender === 'female').length,
      boars: pigs.filter(pig => pig.gender === 'male').length,
      pregnant: pigs.filter(pig => pig.is_pregnant).length,
      sick: pigs.filter(pig => ['sick', 'quarantine'].includes(pig.status)).length,
    },
  };
};
