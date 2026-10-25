import Joi from 'joi';
import { DatabaseHelper } from '../../config/database.js';
import { ValidationError } from '../../middleware/errors.js';

const HEALTH_TYPES = ['vaccination', 'treatment', 'checkup', 'medication', 'surgery', 'other'];

/** The date a record is waiting on: its own date while scheduled, otherwise its booster/next dose. */
export const HEALTH_DUE_DATE_SQL = "CASE WHEN h.status = 'scheduled' THEN h.date ELSE h.next_due END";

const today = () => new Date().toISOString().slice(0, 10);

export const healthHooks = {
  async beforeCreate(_ctx, data) {
    // A record dated in the future is a plan, not something already given.
    if (!data.status) data.status = new Date(data.date).toISOString().slice(0, 10) > today() ? 'scheduled' : 'completed';
  },
};

const bulkSchema = Joi.object({
  scope: Joi.string().valid('pigs', 'pen', 'all').required(),
  pig_ids: Joi.array().items(Joi.string().max(200)).min(1).max(2000).when('scope', { is: 'pigs', then: Joi.required() }),
  pen_id: Joi.string().guid().when('scope', { is: 'pen', then: Joi.required() }),
  type: Joi.string().valid(...HEALTH_TYPES).required(),
  description: Joi.string().trim().max(2000).required(),
  date: Joi.date().iso().required(),
  next_due: Joi.date().iso().allow(null, '').empty(''),
  veterinarian: Joi.string().trim().max(100).allow('', null),
  notes: Joi.string().trim().max(5000).allow('', null),
});

/**
 * One treatment for many pigs at once, e.g. vaccinating a whole pen or deworming the herd.
 * This is how batch-managed farms record health work, rather than pig by pig.
 */
export const recordHealthForGroup = async (ctx, service, body) => {
  const { error, value } = bulkSchema.validate(body ?? {}, { abortEarly: false, stripUnknown: true });
  if (error) throw new ValidationError(`Validation error: ${error.details.map(item => item.message).join(', ')}`);
  return service.runInTransaction(async client => {
    const params = [ctx.farmId];
    let pigFilter = '';
    if (value.scope === 'pigs') { params.push(value.pig_ids); pigFilter = 'AND pig_id = ANY($2)'; }
    if (value.scope === 'pen') { params.push(value.pen_id); pigFilter = 'AND pen_id = $2'; }
    const status = new Date(value.date).toISOString().slice(0, 10) > today() ? 'scheduled' : 'completed';
    const base = params.length;
    const { rows } = await client.query(
      `INSERT INTO health_records (farm_id, pig_id, type, description, date, next_due, status, veterinarian, notes)
       SELECT farm_id, pig_id, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}
       FROM pigs WHERE farm_id = $1 AND is_deleted = 0 ${pigFilter}
       RETURNING id`,
      [...params, value.type, value.description, value.date, value.next_due ?? null, status,
        value.veterinarian || null, value.notes || null]
    );
    if (!rows.length) throw new ValidationError('No pigs matched this selection');
    await service.audit(ctx, client, 'bulk_create', value.scope, null, { pigs: rows.length, type: value.type });
    return { created: rows.length, status };
  });
};

const completeSchema = Joi.object({
  date: Joi.date().iso().max('now').default(() => new Date()),
  next_due: Joi.date().iso().allow(null, '').empty(''),
  notes: Joi.string().trim().max(5000).allow('', null),
});

/**
 * Marks a due item as done. A scheduled record becomes completed; a booster due on a
 * completed record is recorded as a new completed dose and the old reminder is cleared.
 */
export const completeHealthItem = async (ctx, service, id, body) => {
  const { error, value } = completeSchema.validate(body ?? {}, { stripUnknown: true });
  if (error) throw new ValidationError(error.message);
  await service.runInTransaction(async client => {
    const record = await service.lockExisting(ctx, client, id);
    if (record.status === 'scheduled') {
      await client.query(
        `UPDATE health_records SET status = 'completed', date = $2, next_due = COALESCE($3, next_due),
           notes = COALESCE($4, notes) WHERE id = $1`,
        [id, value.date, value.next_due ?? null, value.notes || null]
      );
    } else if (record.next_due) {
      await client.query(
        `INSERT INTO health_records (farm_id, pig_id, type, description, date, next_due, status, veterinarian, notes)
         VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8)`,
        [record.farm_id, record.pig_id, record.type, record.description, value.date, value.next_due ?? null,
          record.veterinarian, value.notes || null]
      );
      await client.query('UPDATE health_records SET next_due = NULL WHERE id = $1', [id]);
    } else {
      throw new ValidationError('This record has nothing due');
    }
    await service.audit(ctx, client, 'complete', id, null, value);
  });
  return { id };
};

/** Headline numbers for the health screen. */
export const healthSummary = async ctx => {
  const { rows } = await DatabaseHelper.executeQuery(
    `SELECT
       COUNT(*) FILTER (WHERE due < CURRENT_DATE)::int AS overdue,
       COUNT(*) FILTER (WHERE due BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS due_this_week,
       COUNT(*) FILTER (WHERE due > CURRENT_DATE + 7)::int AS scheduled_later
     FROM (
       SELECT ${HEALTH_DUE_DATE_SQL} AS due FROM health_records h
       WHERE h.farm_id = $1 AND h.is_deleted = 0 AND h.status <> 'cancelled'
     ) d WHERE due IS NOT NULL`,
    [ctx.farmId]
  );
  const counts = await DatabaseHelper.executeQuery(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'completed' AND date >= date_trunc('month', CURRENT_DATE))::int AS done_this_month,
       COUNT(*) FILTER (WHERE status = 'completed' AND type = 'vaccination' AND date >= date_trunc('year', CURRENT_DATE))::int AS vaccinations_this_year,
       COUNT(DISTINCT pig_id) FILTER (WHERE status = 'completed' AND type IN ('treatment', 'medication')
         AND date >= CURRENT_DATE - 30)::int AS pigs_treated_30d
     FROM health_records WHERE farm_id = $1 AND is_deleted = 0`,
    [ctx.farmId]
  );
  return { ...rows[0], ...counts.rows[0] };
};
