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
