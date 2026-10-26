import dayjs from 'dayjs';
import Joi from 'joi';
import { ValidationError } from '../../middleware/errors.js';
import { displayDate, insertAlerts } from './alerts.js';

export const GESTATION_DAYS = 114;
const WEANING_DAYS = 42;

const findPig = async (client, farmId, pigId) => {
  const { rows } = await client.query(
    'SELECT pig_id, gender, pen_id FROM pigs WHERE farm_id = $1 AND pig_id = $2 AND is_deleted = 0',
    [farmId, pigId]
  );
  return rows[0];
};

const notifyCulling = (client, userId, farmId, sowId, message) => client.query(
  `INSERT INTO notifications (user_id, type, title, message, data, priority)
   VALUES ($1, 'culling_alert', 'Sow Culling Alert', $2, $3::jsonb, 'high')`,
  [userId, message, JSON.stringify({ sow_id: sowId, farm_id: farmId })]
);

export const breedingHooks = {
  async beforeCreate(ctx, data) {
    const { client, farmId } = ctx;
    const sow = await findPig(client, farmId, data.sow_id);
    if (!sow || sow.gender !== 'female') throw new ValidationError('Sow not found on this farm');
    const boar = await findPig(client, farmId, data.boar_id);
    if (!boar || boar.gender !== 'male') throw new ValidationError('Boar not found on this farm');

    const { rows } = await client.query(
      `SELECT actual_birth_date FROM breeding_records
       WHERE farm_id = $1 AND sow_id = $2 AND actual_birth_date IS NOT NULL AND is_deleted = 0
       ORDER BY actual_birth_date DESC LIMIT 1`,
      [farmId, data.sow_id]
    );
    if (rows.length) {
      const earliest = dayjs(rows[0].actual_birth_date).add(WEANING_DAYS + 7, 'day');
      if (dayjs(data.mating_date).isBefore(earliest)) {
        throw new ValidationError('A sow cannot be served within 1 week of weaning');
      }
    }
    data.expected_birth_date ??= dayjs(data.mating_date).add(GESTATION_DAYS, 'day').format('YYYY-MM-DD');
    data.alert_date = dayjs(data.mating_date).add(21, 'day').format('YYYY-MM-DD');
    ctx.sowPenId = sow.pen_id;
  },

  async afterCreate(ctx, record, data) {
    const mating = dayjs(record.mating_date);
    const pen = ctx.sowPenId ?? 'unknown';
    await ctx.client.query(
      `UPDATE pigs SET is_pregnant = true, pregnancy_start_date = $1, expected_birth_date = $2
       WHERE farm_id = $3 AND pig_id = $4 AND is_deleted = 0`,
      [record.mating_date, record.expected_birth_date, record.farm_id, record.sow_id]
    );
    await insertAlerts(ctx.client, { farmId: record.farm_id, userId: ctx.user.id, pigId: record.sow_id, penId: ctx.sowPenId }, [
      {
        name: `Breeding Success for ${record.sow_id} and ${record.boar_id}`,
        start: mating,
        notifyOn: [data.immediate_notify_date ?? mating],
        type: 'breeding',
        severity: 'medium',
        message: data.alert_message || `Breeding recorded for sow ${record.sow_id} and boar ${record.boar_id} on ${displayDate(mating)}. Expected birth date: ${displayDate(record.expected_birth_date)}`,
      },
      {
        name: `Add Nesting Box for ${record.sow_id}`,
        start: mating.add(110, 'day'),
        type: 'breeding',
        severity: 'high',
        message: `Add nesting box for pig ${record.sow_id} on pen ${pen} by ${displayDate(mating.add(110, 'day'))}`,
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        name: `Check Birth for ${record.sow_id}`,
        start: mating.add(110 + index, 'day'),
        type: 'birth',
        severity: 'high',
        message: `Check for birth of pig ${record.sow_id} on pen ${pen} on ${displayDate(mating.add(110 + index, 'day'))}`,
      })),
    ]);
  },

  async afterUpdate(ctx, record, data) {
    if (!data.actual_birth_date || !data.number_of_piglets) return;
    const { client } = ctx;
    const { rows: previous } = await client.query(
      `SELECT number_of_piglets FROM breeding_records
       WHERE farm_id = $1 AND sow_id = $2 AND actual_birth_date IS NOT NULL AND is_deleted = 0
       ORDER BY actual_birth_date DESC LIMIT 3`,
      [record.farm_id, record.sow_id]
    );
    const litters = previous.map(row => row.number_of_piglets || 0).filter(count => count > 0);
    if (litters.length >= 3 && litters.every(count => count < 5)) {
      await notifyCulling(client, ctx.user.id, record.farm_id, record.sow_id,
        `Sow ${record.sow_id} recommended for culling due to low litter size (<5) over 3 generations.`);
    } else if (data.number_of_piglets < 5 || data.number_of_piglets > 10) {
      await notifyCulling(client, ctx.user.id, record.farm_id, record.sow_id,
        `Sow ${record.sow_id} recommended for culling due to litter size ${data.number_of_piglets}.`);
    }

    const { rows: sow } = await client.query(
      `UPDATE pigs SET is_pregnant = false, pregnancy_start_date = NULL, expected_birth_date = NULL, actual_birth_date = $1
       WHERE farm_id = $2 AND pig_id = $3 AND is_deleted = 0 RETURNING pen_id`,
      [data.actual_birth_date, record.farm_id, record.sow_id]
    );
    await client.query(
      `UPDATE alerts SET status = 'completed'
       WHERE farm_id = $1 AND pig_id = $2 AND alert_type = 'breeding' AND status = 'pending' AND is_deleted = false`,
      [record.farm_id, record.sow_id]
    );
    const birth = dayjs(data.actual_birth_date);
    const pen = sow[0]?.pen_id ?? 'unknown';
    const alert = (name, days, severity, verb) => ({
      name: `${name} for ${record.sow_id}`,
      start: birth.add(days, 'day'),
      type: 'birth',
      severity,
      message: `${verb} for pig ${record.sow_id} on pen ${pen} by ${displayDate(birth.add(days, 'day'))}`,
    });
    await insertAlerts(client, { farmId: record.farm_id, userId: ctx.user.id, pigId: record.sow_id, penId: sow[0]?.pen_id }, [
      alert('Fostering Check', 4, 'medium', 'Check fostering needs'),
      alert('Remove Nesting Box', 20, 'medium', 'Remove nesting box'),
      alert('Wean Piglets', WEANING_DAYS, 'high', 'Wean piglets'),
    ]);
  },

  async afterDelete(ctx, record) {
    const { client } = ctx;
    await client.query('UPDATE piglet_records SET is_deleted = 1 WHERE breeding_record_id = $1 AND is_deleted = 0', [record.id]);
    if (!record.actual_birth_date) {
      await client.query(
        `UPDATE pigs SET is_pregnant = false, pregnancy_start_date = NULL, expected_birth_date = NULL
         WHERE farm_id = $1 AND pig_id = $2 AND is_deleted = 0`,
        [record.farm_id, record.sow_id]
      );
      await client.query(
        `UPDATE alerts SET status = 'rejected'
         WHERE farm_id = $1 AND pig_id = $2 AND alert_type IN ('breeding', 'birth') AND status = 'pending' AND is_deleted = false`,
        [record.farm_id, record.sow_id]
      );
    }
  },
};

export const litterSchema = Joi.object({
  breeding_record_id: Joi.string().guid().required(),
  actual_birth_date: Joi.date().iso().max('now').required(),
  piglets: Joi.array().min(1).max(30).items(Joi.object({
    piglet_number: Joi.string().trim().max(50).required(),
    birth_weight: Joi.number().positive().max(10).allow(null),
    gender: Joi.string().valid('male', 'female').allow(null),
    color: Joi.string().trim().max(50).allow('', null),
    status: Joi.string().valid('alive', 'dead', 'weaned', 'sold').default('alive'),
    notes: Joi.string().trim().max(2000).allow('', null),
  })).required(),
});

/** Records a whole litter in one transaction: birth history, piglets and the weaning alert. */
export const recordLitter = async (ctx, service, body) => {
  const { error, value } = litterSchema.validate(body ?? {}, { abortEarly: false, stripUnknown: true });
  if (error) throw new ValidationError(`Validation error: ${error.details.map(item => item.message).join(', ')}`);
  return service.runInTransaction(async client => {
    const { rows } = await client.query(
      `SELECT id, sow_id, boar_id, number_of_piglets FROM breeding_records
       WHERE id = $1 AND farm_id = $2 AND is_deleted = 0 FOR UPDATE`,
      [value.breeding_record_id, ctx.farmId]
    );
    const record = rows[0];
    if (!record) throw new ValidationError('Breeding record not found on this farm');
    const { rows: existing } = await client.query(
      'SELECT COUNT(*)::int AS count FROM piglet_records WHERE breeding_record_id = $1 AND is_deleted = 0',
      [record.id]
    );
    if (record.number_of_piglets && existing[0].count + value.piglets.length > record.number_of_piglets + 1) {
      throw new ValidationError(`This litter was recorded with ${record.number_of_piglets} piglets`);
    }

    const history = await client.query(
      'SELECT id FROM pig_birth_history WHERE breeding_record_id = $1 AND is_deleted = 0',
      [record.id]
    );
    if (!history.rows.length) {
      await client.query(
        `INSERT INTO pig_birth_history (farm_id, sow_id, breeding_record_id, birth_date, number_of_piglets)
         VALUES ($1, $2, $3, $4, $5)`,
        [ctx.farmId, record.sow_id, record.id, value.actual_birth_date, value.piglets.length]
      );
    }

    const weaning = dayjs(value.actual_birth_date).add(WEANING_DAYS, 'day');
    const columns = value.piglets.map(piglet => [
      piglet.piglet_number, piglet.birth_weight ?? null, piglet.gender ?? null,
      piglet.color || null, piglet.status, piglet.notes || null,
    ]);
    const inserted = await client.query(
      `INSERT INTO piglet_records (breeding_record_id, farm_id, piglet_number, birth_weight, gender, color, status,
         notes, weaning_date, parent_male_id, parent_female_id)
       SELECT $1, $2, p.number, p.weight, p.gender, p.color, p.status, p.notes, $9::date, $10, $11
       FROM unnest($3::text[], $4::numeric[], $5::text[], $6::text[], $7::text[], $8::text[])
         AS p(number, weight, gender, color, status, notes)
       RETURNING id, piglet_number`,
      [record.id, ctx.farmId, ...[0, 1, 2, 3, 4, 5].map(index => columns.map(column => column[index])),
        weaning.format('YYYY-MM-DD'), record.boar_id, record.sow_id]
    );

    await insertAlerts(client, { farmId: ctx.farmId, userId: ctx.user.id, pigId: record.sow_id }, [{
      name: `Relocate Piglets for ${record.sow_id}`,
      start: weaning,
      type: 'birth',
      severity: 'medium',
      message: `Relocate piglets for pig ${record.sow_id} to individual pens by ${displayDate(weaning)}`,
    }]);
    await service.audit(ctx, client, 'litter', record.id, null, { piglets: inserted.rows.length });
    return { breeding_record_id: record.id, piglets: inserted.rows };
  });
};
