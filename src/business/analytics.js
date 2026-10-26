import Joi from 'joi';
import { DatabaseHelper } from '../config/database.js';
import { ValidationError } from '../middleware/errors.js';
import logger from '../middleware/logger.js';
import { dashboardWidgets } from './analytics-config.js';
import { hasPermission } from './permissions.js';

const BUCKETS = new Set(['day', 'week', 'month']);
const MAX_RANGE_DAYS = 731;

const rangeSchema = Joi.object({
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  granularity: Joi.string().valid(...BUCKETS),
});

export const resolveRange = query => {
  const { error, value } = rangeSchema.validate(query, { stripUnknown: true });
  if (error) throw new ValidationError(error.message);
  const to = value.to ?? new Date();
  const from = value.from ?? new Date(to.getTime() - 30 * 86_400_000);
  if (from > to) throw new ValidationError('"from" must be before "to"');
  const days = (to - from) / 86_400_000;
  if (days > MAX_RANGE_DAYS) throw new ValidationError('The date range can be at most two years');
  const granularity = value.granularity ?? (days > 120 ? 'month' : days > 31 ? 'week' : 'day');
  return { from, to, granularity };
};

const suppressSmallCohorts = (rows, widget, permissions) => {
  if (!widget.minCohort) return rows;
  const visible = hasPermission(permissions, 'customers', 'read') ? rows : rows.filter(row => row.farms >= widget.minCohort);
  return visible.map(({ farms: _farms, ...row }) => row);
};

/** Runs every widget the admin's permissions allow, in parallel; a failing widget degrades to empty data. */
export const buildDashboard = async (permissions, query) => {
  const range = resolveRange(query);
  const entries = Object.entries(dashboardWidgets).filter(([, widget]) => {
    const [object, operation] = widget.permission.split('.');
    return hasPermission(permissions, object, operation);
  });
  const results = await Promise.all(entries.map(async ([key, widget]) => {
    const sql = widget.sql.replaceAll('{bucket}', range.granularity);
    const params = sql.includes('$1') ? [range.from, range.to] : [];
    // Same-length period immediately before, for "vs previous period" on stats.
    const previousParams = [new Date(range.from.getTime() - (range.to - range.from)), range.from];
    const { sql: _sql, permission: _permission, compare: _compare, ...meta } = widget;
    try {
      const { rows } = await DatabaseHelper.executeQuery(sql, params);
      if (widget.kind === 'stat') {
        const value = Number(rows[0]?.value ?? 0);
        if (!widget.compare) return [key, { ...meta, value }];
        const previous = await DatabaseHelper.executeQuery(sql, previousParams);
        return [key, { ...meta, value, previous: Number(previous.rows[0]?.value ?? 0) }];
      }
      if (widget.kind === 'breakdown') {
        const row = rows[0] ?? {};
        return [key, { ...meta, value: Number(row.value ?? 0), parts: Object.fromEntries(widget.breakdown.map(part => [part, Number(row[part] ?? 0)])) }];
      }
      return [key, { ...meta, data: suppressSmallCohorts(rows, widget, permissions) }];
    } catch (error) {
      logger.error(`Dashboard widget ${key} failed: ${error.message}`);
      return [key, { ...meta, error: true, data: [], value: 0 }];
    }
  }));
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), granularity: range.granularity },
    widgets: Object.fromEntries(results),
    order: results.map(([key]) => key),
  };
};
