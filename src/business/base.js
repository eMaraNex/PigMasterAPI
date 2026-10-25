import Joi from 'joi';
import { DatabaseHelper } from '../config/database.js';
import { ForbiddenError, ValidationError } from '../middleware/errors.js';
import logger from '../middleware/logger.js';
import {
  applyFilters,
  assertIdentifier,
  assertUuid,
  buildColumnMap,
  notFound,
  parseFilters,
  parsePagination,
  parseSearch,
  parseSort,
  toCsv,
  toXlsx,
  translateDbError,
  XLSX_CONTENT_TYPE,
} from './helpers.js';

const RESERVED_QUERY_KEYS = new Set([
  'page', 'limit', 'pageSize', 'pagination', 'sort', 'search', 'filter', 'filters',
  'fields', 'dateRange', 'include', 'format', 'columns', 'title', 'filename',
]);
const EXPORT_LIMIT = 10_000;

/**
 * Config-driven CRUD for one business object. Every SQL identifier comes from the
 * object config; request input only ever reaches SQL as bound parameters.
 *
 * ctx = { user, farmId, admin, adminRole, ip, userAgent }
 */
export class BaseBusinessLogic {
  constructor(objectKey, config) {
    this.objectKey = objectKey;
    this.config = config;
    assertIdentifier(config.table, objectKey);
    assertIdentifier(config.alias, objectKey);
    this.columns = buildColumnMap(config, objectKey);
    this.primaryKey = config.primaryKey ?? 'id';
  }

  assertId(id) {
    const idType = this.config.idType ?? 'uuid';
    if (idType === 'uuid') assertUuid(id);
    if (idType === 'integer' && !/^[1-9][0-9]{0,9}$/.test(String(id))) throw notFound(this.config);
  }

  // ---------------------------------------------------------------- scoping

  /** Conditions every query on this object must carry: soft delete, tenant and base filters. */
  scopeConditions(ctx, params, alias = this.config.alias, { write = false } = {}) {
    const where = [];
    const { softDelete, tenant, baseWhere } = this.config;
    if (softDelete) {
      where.push(`${alias}.${softDelete.column} = ${softDelete.active}`);
    }
    if (tenant?.type === 'farm') {
      if (!ctx.farmId) throw new ValidationError('Create or select a farm first');
      params.push(ctx.farmId);
      where.push(`${alias}.${tenant.field} = $${params.length}`);
    } else if (tenant?.type === 'owner') {
      params.push(ctx.user.id);
      const owned = `${alias}.${tenant.field} = $${params.length}`;
      // Farm team members may read the farms they belong to; only the owner may change them.
      where.push(tenant.membersCanRead && !write
        ? `(${owned} OR EXISTS (SELECT 1 FROM farm_members fm WHERE fm.farm_id = ${alias}.${this.primaryKey}
             AND fm.user_id = $${params.length} AND fm.status = 'active'))`
        : owned);
    }
    if (baseWhere) where.push(baseWhere(alias));
    return where;
  }

  fromClause() {
    const { table, alias, joins = [] } = this.config;
    return [`${table} ${alias}`, ...joins.map(join => `${join.type ?? 'LEFT'} JOIN ${join.table} ${join.alias} ON ${join.on}`)].join(' ');
  }

  /** Relations named in ?include=a,b are added to list rows; detail views always get all of them. */
  includedRelations(input) {
    const raw = input?.include;
    const names = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
    const relations = this.config.relations ?? {};
    return new Set(names.map(name => name.trim()).filter(name => Object.hasOwn(relations, name)));
  }

  selectList(includeDetail, included = new Set()) {
    const fields = [`${this.config.alias}.*`];
    for (const join of this.config.joins ?? []) {
      for (const [name, column] of Object.entries(join.columns)) {
        fields.push(`${typeof column === 'string' ? column : column.sql} AS ${name}`);
      }
    }
    for (const [name, column] of Object.entries(this.config.columns)) {
      if (column.sql) fields.push(`${column.sql} AS ${name}`);
    }
    for (const [name, relation] of Object.entries(this.config.relations ?? {})) {
      if (includeDetail || relation.inList || included.has(name)) {
        fields.push(`${relation.sql(this.config.alias)} AS ${name}`);
      }
    }
    return fields.join(', ');
  }

  hidden(row) {
    if (!row) return row;
    for (const field of this.config.hiddenFields ?? []) delete row[field];
    return row;
  }

  // ---------------------------------------------------------------- reads

  async list(ctx, input = {}, { maxLimit } = {}) {
    const { page, limit, offset } = parsePagination(input, maxLimit ? { ...this.config, maxLimit } : this.config);
    const params = [];
    const where = this.scopeConditions(ctx, params);
    applyFilters(parseFilters(input, this.columns, RESERVED_QUERY_KEYS), where, params);

    const dateRange = input.dateRange;
    if (dateRange?.field && (dateRange.from || dateRange.to)) {
      const column = this.columns.get(dateRange.field);
      if (!column || !column.filterable) throw new ValidationError(`Cannot filter by "${dateRange.field}"`);
      if (dateRange.from) { params.push(dateRange.from); where.push(`${column.sql} >= $${params.length}`); }
      if (dateRange.to) { params.push(dateRange.to); where.push(`${column.sql} <= $${params.length}`); }
    }

    const search = parseSearch(input);
    if (search) {
      const searchable = [...this.columns.values()].filter(column => column.searchable);
      if (searchable.length) {
        params.push(`%${search}%`);
        where.push(`(${searchable.map(column => `${column.sql}::text ILIKE $${params.length}`).join(' OR ')})`);
      }
    }

    const orderBy = [...parseSort(input, this.columns, this.config), `${this.config.alias}.${this.primaryKey} ASC`];
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = this.fromClause();

    const [countResult, dataResult] = await Promise.all([
      DatabaseHelper.executeQuery(`SELECT COUNT(*)::int AS total FROM ${from} ${whereSql}`, params),
      DatabaseHelper.executeQuery(
        `SELECT ${this.selectList(false, this.includedRelations(input))} FROM ${from} ${whereSql}
         ORDER BY ${orderBy.join(', ')} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
    ]);
    const total = countResult.rows[0].total;
    return {
      data: dataResult.rows.map(row => this.hidden(row)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getById(ctx, id, client = null) {
    this.assertId(id);
    const params = [id];
    const where = [`${this.config.alias}.${this.primaryKey} = $1`, ...this.scopeConditions(ctx, params)];
    const runner = client ?? DatabaseHelper;
    const sql = `SELECT ${this.selectList(true)} FROM ${this.fromClause()} WHERE ${where.join(' AND ')}`;
    const result = client ? await client.query(sql, params) : await runner.executeQuery(sql, params);
    if (!result.rows.length) throw notFound(this.config);
    return this.hidden(result.rows[0]);
  }

  /** Locks the scoped base row for a write; throws 404 when it is outside the caller's tenant. */
  async lockExisting(ctx, client, id) {
    this.assertId(id);
    const params = [id];
    const where = [`${this.config.alias}.${this.primaryKey} = $1`, ...this.scopeConditions(ctx, params, this.config.alias, { write: true })];
    const result = await client.query(
      `SELECT ${this.config.alias}.* FROM ${this.config.table} ${this.config.alias}
       WHERE ${where.join(' AND ')} FOR UPDATE`,
      params
    );
    if (!result.rows.length) throw notFound(this.config);
    return result.rows[0];
  }

  // ---------------------------------------------------------------- writes

  validate(schemaName, data) {
    const schema = this.config.schemas?.[schemaName];
    if (!schema) throw new ForbiddenError(`${schemaName} is not allowed on ${this.objectKey}`);
    const { error, value } = schema.validate(data ?? {}, { abortEarly: false, stripUnknown: true, convert: true });
    if (error) {
      throw new ValidationError(`Validation error: ${error.details.map(detail => detail.message).join(', ')}`);
    }
    return value;
  }

  /** Only real, writable base-table columns reach INSERT/UPDATE. */
  writableEntries(data) {
    return Object.entries(data).filter(([key, value]) => {
      const column = this.columns.get(key);
      return column?.writable && value !== undefined && key !== this.primaryKey;
    });
  }

  serialise(key, value) {
    const type = this.columns.get(key)?.type;
    if (type === 'json' && value !== null) return JSON.stringify(value);
    if (type === 'flag' && value !== null) return value ? 1 : 0;
    return value;
  }

  async audit(ctx, client, action, entityId, oldValues, newValues) {
    if (this.config.audit === false) return;
    if (ctx.admin) {
      await client.query(
        `INSERT INTO admin_audit_logs (actor_user_id, action, ip_address, filters)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [ctx.admin.id, `${this.objectKey}.${action}`, ctx.ip ?? null, JSON.stringify({ id: entityId })]
      );
      return;
    }
    await client.query(
      `INSERT INTO activity_logs (user_id, farm_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
      [
        ctx.user?.id ?? null,
        this.config.tenant?.type === 'owner' ? entityId : ctx.farmId ?? null,
        action,
        this.objectKey,
        String(entityId),
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ctx.ip ?? null,
        ctx.userAgent?.slice(0, 500) ?? null,
      ]
    );
  }

  async runInTransaction(fn) {
    try {
      return await DatabaseHelper.withTransaction(fn);
    } catch (error) {
      const translated = translateDbError(error, this.config);
      if (translated === error && !error.isOperational) {
        logger.error(`${this.objectKey} write failed: ${error.message}`);
      }
      throw translated;
    }
  }

  async create(ctx, body) {
    const data = this.validate('create', body);
    const { hooks = {}, tenant } = this.config;
    const created = await this.runInTransaction(async client => {
      const hookCtx = { ...ctx, client, service: this };
      if (hooks.beforeCreate) await hooks.beforeCreate(hookCtx, data);
      if (tenant?.type === 'farm') data[tenant.field] = ctx.farmId;
      if (tenant?.type === 'owner') data[tenant.field] = ctx.user.id;

      const entries = this.writableEntries(data);
      if (tenant) entries.push([tenant.field, data[tenant.field]]);
      const columns = entries.map(([key]) => key);
      const values = entries.map(([key, value]) => this.serialise(key, value));
      const result = await client.query(
        `INSERT INTO ${this.config.table} (${columns.join(', ')})
         VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING *`,
        values
      );
      const row = result.rows[0];
      if (hooks.afterCreate) await hooks.afterCreate(hookCtx, row, data);
      await this.audit(ctx, client, 'create', row[this.primaryKey], null, data);
      return row;
    });
    return this.getById(ctx, created[this.primaryKey]);
  }

  async update(ctx, id, body) {
    const data = this.validate('update', body);
    const { hooks = {} } = this.config;
    await this.runInTransaction(async client => {
      const hookCtx = { ...ctx, client, service: this };
      const existing = await this.lockExisting(ctx, client, id);
      if (hooks.beforeUpdate) await hooks.beforeUpdate(hookCtx, existing, data);
      const entries = this.writableEntries(data);
      if (entries.length) {
        const sets = entries.map(([key], index) => `${key} = $${index + 2}`);
        await client.query(
          `UPDATE ${this.config.table} SET ${sets.join(', ')} WHERE ${this.primaryKey} = $1`,
          [id, ...entries.map(([key, value]) => this.serialise(key, value))]
        );
      }
      if (hooks.afterUpdate) await hooks.afterUpdate(hookCtx, existing, data);
      await this.audit(ctx, client, 'update', id, existing, data);
    });
    return this.getById(ctx, id);
  }

  async delete(ctx, id, body) {
    const { hooks = {}, softDelete } = this.config;
    const data = this.config.schemas?.delete ? this.validate('delete', body) : {};
    await this.runInTransaction(async client => {
      const hookCtx = { ...ctx, client, service: this };
      const existing = await this.lockExisting(ctx, client, id);
      let mode = softDelete ? 'soft' : 'hard';
      if (hooks.beforeDelete) mode = (await hooks.beforeDelete(hookCtx, existing, data)) ?? mode;
      if (mode === 'soft') {
        await client.query(
          `UPDATE ${this.config.table} SET ${softDelete.column} = ${softDelete.deleted} WHERE ${this.primaryKey} = $1`,
          [id]
        );
      } else {
        await client.query(`DELETE FROM ${this.config.table} WHERE ${this.primaryKey} = $1`, [id]);
      }
      if (hooks.afterDelete) await hooks.afterDelete(hookCtx, existing, data);
      await this.audit(ctx, client, 'delete', id, existing, Object.keys(data).length ? data : null);
    });
    return { id };
  }

  // ---------------------------------------------------------------- export

  async export(ctx, input = {}) {
    const exportable = this.config.export?.columns ?? [...this.columns.keys()].map(field => ({ field }));
    const requested = Array.isArray(input.columns) && input.columns.length
      ? input.columns.map(column => (typeof column === 'string' ? { field: column } : column))
      : exportable;
    const allowed = new Set(exportable.map(column => column.field));
    const fields = requested.filter(column => allowed.has(column.field)).map(column => ({
      field: column.field,
      header: exportable.find(item => item.field === column.field)?.header ?? column.header ?? column.field,
    }));
    if (!fields.length) throw new ValidationError('Select at least one exportable column');

    const result = await this.list(ctx, { ...input, page: 1, limit: EXPORT_LIMIT, pagination: undefined }, { maxLimit: EXPORT_LIMIT });
    const format = ['json', 'xlsx'].includes(input.format) ? input.format : 'csv';
    const filename = `${this.objectKey}-${new Date().toISOString().slice(0, 10)}.${format}`;
    if (format === 'json') {
      const data = result.data.map(row => Object.fromEntries(fields.map(({ field }) => [field, row[field]])));
      return { filename, contentType: 'application/json', body: JSON.stringify({ total: result.total, data }), truncated: result.total > EXPORT_LIMIT };
    }
    if (format === 'xlsx') {
      const body = await toXlsx([{ name: this.config.label, fields, rows: result.data }]);
      return { filename, contentType: XLSX_CONTENT_TYPE, body, truncated: result.total > EXPORT_LIMIT };
    }
    return { filename, contentType: 'text/csv; charset=utf-8', body: toCsv(result.data, fields), truncated: result.total > EXPORT_LIMIT };
  }
}

/** Shared Joi building blocks for object configs. */
export const schema = {
  uuid: () => Joi.string().guid({ version: ['uuidv4', 'uuidv1', 'uuidv5', 'uuidv7'] }),
  text: (max = 255) => Joi.string().trim().max(max),
  notes: () => Joi.string().trim().max(5000).allow('', null),
  date: () => Joi.date().iso(),
  money: () => Joi.number().precision(2).min(0).max(100_000_000),
};
