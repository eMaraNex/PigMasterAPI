import Joi from 'joi';
import { DatabaseHelper } from '../../config/database.js';
import { ValidationError } from '../../middleware/errors.js';

export const MAX_PIGS_PER_PEN = 6;

/** Locks the pen row so two concurrent requests cannot both take its last place. */
const assertPenHasSpace = async (client, farmId, penId, excludePigId = null) => {
  const { rows } = await client.query(
    'SELECT id, name FROM pens WHERE id = $1 AND farm_id = $2 AND is_deleted = 0 FOR UPDATE',
    [penId, farmId]
  );
  if (!rows.length) throw new ValidationError('Pen not found on this farm');
  const count = await client.query(
    `SELECT COUNT(*)::int AS pigs FROM pigs
     WHERE pen_id = $1 AND is_deleted = 0 AND ($2::uuid IS NULL OR id <> $2)`,
    [penId, excludePigId]
  );
  if (count.rows[0].pigs >= MAX_PIGS_PER_PEN) {
    throw new ValidationError(`Pen ${rows[0].name} already holds the maximum of ${MAX_PIGS_PER_PEN} pigs`);
  }
  return rows[0];
};

export const pigRemovalSchema = Joi.object({
  reason: Joi.string().valid(
    'sale', 'death - natural', 'death - disease', 'death - accident', 'transfer to another farm',
    'breeding loan', 'retirement', 'health issues', 'other', 'transfer to another pen', 'lost', 'stolen'
  ).required(),
  notes: Joi.string().trim().max(5000).allow('', null),
  date: Joi.date().iso().max('now').default(() => new Date()),
  sale_amount: Joi.number().min(0).allow(null),
  sale_weight: Joi.number().positive().allow(null),
  sold_to: Joi.string().trim().max(100).allow('', null),
});

export const pigHooks = {
  async beforeCreate(ctx, data) {
    if (data.pen_id) await assertPenHasSpace(ctx.client, ctx.farmId, data.pen_id);
  },

  async afterCreate(ctx, pig) {
    if (pig.pen_id) {
      await ctx.client.query(
        'INSERT INTO pen_pig_history (pen_id, pig_id, farm_id) VALUES ($1, $2, $3)',
        [pig.pen_id, pig.pig_id, pig.farm_id]
      );
    }
  },

  async beforeDelete(ctx, pig, removal) {
    await ctx.client.query(
      `INSERT INTO removal_records (pig_id, pen_id, farm_id, reason, notes, date, sale_amount, sale_weight, sold_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [pig.pig_id, pig.pen_id, pig.farm_id, removal.reason, removal.notes || null, removal.date,
        removal.sale_amount ?? null, removal.sale_weight ?? null, removal.sold_to || null]
    );
    if (pig.pen_id) {
      await ctx.client.query(
        `UPDATE pen_pig_history
         SET removed_at = CURRENT_TIMESTAMP, removal_reason = $1, removal_notes = $2,
             sale_amount = $3, sale_date = $4, sale_weight = $5, sold_to = $6
         WHERE farm_id = $7 AND pen_id = $8 AND pig_id = $9 AND removed_at IS NULL AND is_deleted = 0`,
        [removal.reason, removal.notes || null, removal.sale_amount ?? null, removal.date,
          removal.sale_weight ?? null, removal.sold_to || null, pig.farm_id, pig.pen_id, pig.pig_id]
      );
    }
    return 'soft';
  },
};

export const pigTransferSchema = Joi.object({
  new_pen_id: Joi.string().guid().required(),
  transfer_reason: Joi.string().valid(
    'quarantine', 'cannibalism_prevention', 'breeding_program', 'overcrowding',
    'facility_maintenance', 'social_grouping', 'other'
  ).required(),
  transfer_notes: Joi.string().trim().max(2000).allow('', null),
});

export const transferPig = async (ctx, service, pigId, body) => {
  const { error, value } = pigTransferSchema.validate(body ?? {}, { abortEarly: false, stripUnknown: true });
  if (error) throw new ValidationError(`Validation error: ${error.details.map(item => item.message).join(', ')}`);
  await service.runInTransaction(async client => {
    const pig = await service.lockExisting(ctx, client, pigId);
    if (pig.pen_id === value.new_pen_id) throw new ValidationError('The pig is already in this pen');
    await assertPenHasSpace(client, ctx.farmId, value.new_pen_id, pig.id);
    await client.query('UPDATE pigs SET pen_id = $1 WHERE id = $2', [value.new_pen_id, pig.id]);
    await client.query(
      `INSERT INTO pig_transfer_history (farm_id, pig_id, old_pen_id, new_pen_id, transfer_reason, transfer_notes, transferred_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.farmId, pig.pig_id, pig.pen_id, value.new_pen_id, value.transfer_reason, value.transfer_notes || null, ctx.user.id]
    );
    if (pig.pen_id) {
      await client.query(
        `UPDATE pen_pig_history SET removed_at = CURRENT_TIMESTAMP, removal_reason = 'transfer to another pen'
         WHERE farm_id = $1 AND pen_id = $2 AND pig_id = $3 AND removed_at IS NULL AND is_deleted = 0`,
        [ctx.farmId, pig.pen_id, pig.pig_id]
      );
    }
    await client.query(
      'INSERT INTO pen_pig_history (pen_id, pig_id, farm_id) VALUES ($1, $2, $3)',
      [value.new_pen_id, pig.pig_id, ctx.farmId]
    );
    await service.audit(ctx, client, 'transfer', pig.id, { pen_id: pig.pen_id }, value);
  });
  return service.getById(ctx, pigId);
};

/** Herd summary for the whole farm (unaffected by list filters). */
export const pigStatistics = async ctx => {
  const { rows } = await DatabaseHelper.executeQuery(
    `SELECT
       COUNT(*)::int AS total_pigs,
       COUNT(*) FILTER (WHERE gender = 'male')::int AS male_count,
       COUNT(*) FILTER (WHERE gender = 'female')::int AS female_count,
       COUNT(*) FILTER (WHERE is_pregnant)::int AS pregnant_count,
       COUNT(*) FILTER (WHERE gender = 'male' AND EXISTS (
         SELECT 1 FROM breeding_records br
         WHERE br.farm_id = p.farm_id AND br.boar_id = p.pig_id AND br.is_deleted = 0
       ))::int AS breeder_boar_count,
       COALESCE((
         SELECT jsonb_object_agg(breed, jsonb_build_object('males', males, 'females', females, 'total', total))
         FROM (
           SELECT COALESCE(breed, 'Unknown') AS breed,
             COUNT(*) FILTER (WHERE gender = 'male')::int AS males,
             COUNT(*) FILTER (WHERE gender = 'female')::int AS females,
             COUNT(*)::int AS total
           FROM pigs WHERE farm_id = $1 AND is_deleted = 0 GROUP BY 1
         ) breeds
       ), '{}'::jsonb) AS breed_distribution
     FROM pigs p WHERE p.farm_id = $1 AND p.is_deleted = 0`,
    [ctx.farmId]
  );
  const stats = rows[0];
  return {
    totalPigs: stats.total_pigs,
    maleCount: stats.male_count,
    femaleCount: stats.female_count,
    pregnantCount: stats.pregnant_count,
    breederBoarCount: stats.breeder_boar_count,
    breedDistribution: stats.breed_distribution,
  };
};
