import { ValidationError } from '../../middleware/errors.js';

// ---------------------------------------------------------------- farms

export const farmHooks = {
  async afterCreate(ctx, farm) {
    // The first farm becomes the user's active farm.
    await ctx.client.query(
      'UPDATE users SET farm_id = $1 WHERE id = $2 AND farm_id IS NULL',
      [farm.id, ctx.user.id]
    );
  },

  async afterDelete(ctx, farm) {
    for (const table of ['rows', 'pens', 'pigs']) {
      await ctx.client.query(`UPDATE ${table} SET is_deleted = 1 WHERE farm_id = $1 AND is_deleted = 0`, [farm.id]);
    }
    // Move the user to another remaining farm (or none) if the active farm was removed.
    await ctx.client.query(
      `UPDATE users SET farm_id = (
         SELECT id FROM farms WHERE created_by = $2 AND is_deleted = 0 ORDER BY created_at LIMIT 1
       ) WHERE id = $2 AND farm_id = $1`,
      [farm.id, ctx.user.id]
    );
  },
};

// ---------------------------------------------------------------- rows

/** Spreads `capacity` pens across levels A, B, C... as evenly as possible. */
export const distributePens = (capacity, levels) => {
  const base = Math.floor(capacity / levels.length);
  const remainder = capacity % levels.length;
  return levels.flatMap((level, index) =>
    Array.from({ length: base + (index < remainder ? 1 : 0) }, (_, position) => ({ level, position: position + 1 }))
  );
};

export const rowHooks = {
  async afterCreate(ctx, row) {
    const slots = distributePens(row.capacity, row.levels);
    await ctx.client.query(
      `INSERT INTO pens (row_id, farm_id, name, level, position)
       SELECT $1, $2, $3 || '-' || slot.level || slot.position, slot.level, slot.position
       FROM unnest($4::text[], $5::int[]) AS slot(level, position)`,
      [row.id, row.farm_id, row.name, slots.map(slot => slot.level), slots.map(slot => slot.position)]
    );
  },

  async beforeUpdate(ctx, row, data) {
    if (data.capacity !== undefined) {
      const { rows } = await ctx.client.query(
        'SELECT COUNT(*)::int AS pens FROM pens WHERE row_id = $1 AND is_deleted = 0',
        [row.id]
      );
      if (data.capacity < rows[0].pens) {
        throw new ValidationError(`Capacity cannot be lower than the ${rows[0].pens} pens already in this row`);
      }
    }
  },

  async beforeDelete(ctx, row) {
    const { rows } = await ctx.client.query(
      `SELECT COUNT(*)::int AS pigs FROM pigs p JOIN pens pn ON pn.id = p.pen_id
       WHERE pn.row_id = $1 AND p.is_deleted = 0`,
      [row.id]
    );
    if (rows[0].pigs > 0) throw new ValidationError(`Cannot delete a row with ${rows[0].pigs} pigs in it`);
    return 'soft';
  },

  async afterDelete(ctx, row) {
    await ctx.client.query('UPDATE pens SET is_deleted = 1 WHERE row_id = $1 AND is_deleted = 0', [row.id]);
  },
};

/** Adds capacity to a row (the extra pens are created by the farmer as needed). */
export const expandRow = async (ctx, service, rowId, additionalCapacity) => {
  if (!Number.isInteger(additionalCapacity) || additionalCapacity < 1 || additionalCapacity > 200) {
    throw new ValidationError('additionalCapacity must be a whole number between 1 and 200');
  }
  return service.runInTransaction(async client => {
    const row = await service.lockExisting(ctx, client, rowId);
    if (row.capacity + additionalCapacity > 200) throw new ValidationError('A row can hold at most 200 pens');
    await client.query('UPDATE rows SET capacity = capacity + $2 WHERE id = $1', [rowId, additionalCapacity]);
    await service.audit(ctx, client, 'expand', rowId, { capacity: row.capacity }, { additionalCapacity });
    return { id: rowId, capacity: row.capacity + additionalCapacity };
  });
};

// ---------------------------------------------------------------- pens

export const penHooks = {
  async beforeCreate(ctx, data) {
    const { rows } = await ctx.client.query(
      `SELECT name, levels, capacity,
         (SELECT COUNT(*)::int FROM pens WHERE row_id = r.id AND is_deleted = 0) AS pens
       FROM rows r WHERE id = $1 AND farm_id = $2 AND is_deleted = 0 FOR UPDATE`,
      [data.row_id, ctx.farmId]
    );
    const row = rows[0];
    if (!row) throw new ValidationError('Row not found on this farm');
    if (!row.levels.includes(data.level)) throw new ValidationError(`Level must be one of ${row.levels.join(', ')}`);
    if (row.pens >= row.capacity) throw new ValidationError('Row capacity reached. Expand the row first.');
    const expectedName = `${row.name}-${data.level}${data.position}`;
    if (data.name && data.name !== expectedName) {
      throw new ValidationError(`Pen name must be ${expectedName} for this row, level and position`);
    }
    data.name = expectedName;
  },

  async beforeUpdate(ctx, pen, data) {
    const level = data.level ?? pen.level;
    const position = data.position ?? pen.position;
    if (data.level !== undefined || data.position !== undefined) {
      const { rows } = await ctx.client.query('SELECT name, levels FROM rows WHERE id = $1', [pen.row_id]);
      if (rows[0] && !rows[0].levels.includes(level)) {
        throw new ValidationError(`Level must be one of ${rows[0].levels.join(', ')}`);
      }
      if (rows[0]) data.name = `${rows[0].name}-${level}${position}`;
    }
  },

  async beforeDelete(ctx, pen) {
    const { rows } = await ctx.client.query(
      `SELECT
         EXISTS (SELECT 1 FROM pigs WHERE pen_id = $1 AND is_deleted = 0) AS has_pigs,
         EXISTS (SELECT 1 FROM pen_pig_history WHERE pen_id = $1)
           OR EXISTS (SELECT 1 FROM feeding_records WHERE pen_id = $1)
           OR EXISTS (SELECT 1 FROM earnings_records WHERE pen_id = $1)
           OR EXISTS (SELECT 1 FROM removal_records WHERE pen_id = $1)
           OR EXISTS (SELECT 1 FROM pig_transfer_history WHERE new_pen_id = $1 OR old_pen_id = $1) AS has_history`,
      [pen.id]
    );
    if (rows[0].has_pigs) throw new ValidationError('Cannot delete a pen with pigs. Move or remove the pigs first.');
    // Keep pens with history for reporting; free the slot otherwise.
    return rows[0].has_history ? 'soft' : 'hard';
  },
};
