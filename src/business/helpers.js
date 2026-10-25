import { CustomError, NotFoundError, ValidationError } from '../middleware/errors.js';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATORS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'in', 'notIn', 'isEmpty', 'isNotEmpty']);
const MAX_SEARCH_LENGTH = 100;

export class ConflictError extends CustomError {
  constructor(message) {
    super(message, 409);
  }
}

export const assertIdentifier = (value, where) => {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`Invalid SQL identifier "${value}" in ${where}`);
  }
};

export const isUuid = value => typeof value === 'string' && UUID.test(value);

export const assertUuid = (value, label = 'id') => {
  if (!isUuid(value)) throw new ValidationError(`${label} must be a valid UUID`);
};

/**
 * Builds the whitelist of fields a client may select, sort, filter or search on.
 * Keys are API field names; values carry the trusted SQL expression from config.
 */
export const buildColumnMap = (config, objectKey) => {
  const map = new Map();
  for (const [name, column] of Object.entries(config.columns)) {
    assertIdentifier(name, `${objectKey}.columns`);
    map.set(name, {
      sql: column.sql ?? `${config.alias}.${name}`,
      type: column.type ?? 'text',
      sortable: column.sortable !== false,
      filterable: column.filterable !== false,
      searchable: Boolean(column.searchable),
      writable: !column.sql && column.writable !== false,
    });
  }
  for (const join of config.joins ?? []) {
    for (const [name, sql] of Object.entries(join.columns)) {
      assertIdentifier(name, `${objectKey}.joins`);
      const column = typeof sql === 'string' ? { sql } : sql;
      map.set(name, {
        sql: column.sql,
        type: column.type ?? 'text',
        sortable: column.sortable !== false,
        filterable: column.filterable !== false,
        searchable: Boolean(column.searchable),
        writable: false,
      });
    }
  }
  return map;
};

const clampInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

export const parsePagination = (input, config) => {
  const maxLimit = config.maxLimit ?? 100;
  const source = input.pagination ?? input;
  const limit = clampInt(source.limit ?? source.pageSize, config.defaultLimit ?? 10, 1, maxLimit);
  const page = clampInt(source.page, 1, 1, 1_000_000);
  return { page, limit, offset: (page - 1) * limit };
};

/** Accepts sort as [{field, order}], "field:desc" or "-field". */
export const parseSort = (input, columns, config) => {
  let items = input.sort;
  if (typeof items === 'string') {
    items = items.split(',').filter(Boolean).map(part => {
      const [field, order] = part.startsWith('-') ? [part.slice(1), 'DESC'] : part.split(':');
      return { field, order };
    });
  }
  if (!Array.isArray(items) || items.length === 0) items = [config.defaultSort];
  return items.slice(0, 3).map(item => {
    const column = columns.get(item.field);
    if (!column || !column.sortable) {
      throw new ValidationError(`Cannot sort by "${item.field}"`);
    }
    const order = String(item.order ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    return `${column.sql} ${order} NULLS LAST`;
  });
};

/**
 * Filters may come as an array of {field, operator, value} (POST body) or as plain
 * query-string equality pairs (?pen_id=...). Unknown fields are rejected, never interpolated.
 */
export const parseFilters = (input, columns, reservedKeys) => {
  const filters = [];
  const list = input.filters?.filter ?? input.filter ?? input.filters;
  if (Array.isArray(list)) filters.push(...list);
  for (const [key, value] of Object.entries(input)) {
    if (reservedKeys.has(key) || value === undefined || value === '') continue;
    if (columns.has(key)) filters.push({ field: key, operator: Array.isArray(value) ? 'in' : 'eq', value });
  }
  return filters.map(filter => {
    const column = columns.get(filter.field);
    if (!column || !column.filterable) {
      throw new ValidationError(`Cannot filter by "${filter.field}"`);
    }
    const operator = filter.operator ?? 'eq';
    if (!OPERATORS.has(operator)) throw new ValidationError(`Unsupported filter operator "${operator}"`);
    return { column, operator, value: filter.value };
  });
};

export const parseSearch = input => {
  const raw = typeof input.search === 'object' && input.search !== null ? input.search.value : input.search;
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim().slice(0, MAX_SEARCH_LENGTH);
  return value ? value.replace(/[\\%_]/g, '\\$&') : null;
};

const cast = type => {
  switch (type) {
    case 'number': return '::numeric';
    case 'integer': return '::int';
    case 'boolean': return '::boolean';
    case 'flag': return '::int';
    case 'date': return '::date';
    case 'datetime': return '::timestamptz';
    case 'uuid': return '::uuid';
    default: return '';
  }
};

/** Appends parameterised conditions to `where`, pushing values into `params`. */
export const applyFilters = (filters, where, params) => {
  for (const { column, operator, value: rawValue } of filters) {
    const value = column.type === 'flag' && typeof rawValue !== 'number'
      ? (['true', '1', true].includes(rawValue) ? 1 : 0)
      : rawValue;
    const add = v => {
      params.push(v);
      return `$${params.length}${cast(column.type)}`;
    };
    switch (operator) {
      case 'eq': where.push(`${column.sql} = ${add(value)}`); break;
      case 'neq': where.push(`${column.sql} IS DISTINCT FROM ${add(value)}`); break;
      case 'gt': where.push(`${column.sql} > ${add(value)}`); break;
      case 'gte': where.push(`${column.sql} >= ${add(value)}`); break;
      case 'lt': where.push(`${column.sql} < ${add(value)}`); break;
      case 'lte': where.push(`${column.sql} <= ${add(value)}`); break;
      case 'like':
        params.push(`%${String(value).replace(/[\\%_]/g, '\\$&')}%`);
        where.push(`${column.sql}::text ILIKE $${params.length}`);
        break;
      case 'in':
      case 'notIn': {
        const values = (Array.isArray(value) ? value : String(value).split(',')).slice(0, 200);
        if (values.length === 0) break;
        params.push(values);
        const typeCast = cast(column.type) || '::text';
        where.push(`${operator === 'notIn' ? 'NOT ' : ''}(${column.sql}${column.type === 'text' ? '::text' : ''} = ANY($${params.length}${typeCast}[]))`);
        break;
      }
      case 'isEmpty': where.push(`(${column.sql} IS NULL OR ${column.sql}::text = '')`); break;
      case 'isNotEmpty': where.push(`(${column.sql} IS NOT NULL AND ${column.sql}::text <> '')`); break;
      default: break;
    }
  }
};

/** Translates PostgreSQL constraint errors into client errors with readable messages. */
export const translateDbError = (error, config) => {
  if (!error?.code) return error;
  switch (error.code) {
    case '23505':
      return new ConflictError(config.messages?.duplicate ?? `This ${config.label ?? 'record'} already exists`);
    case '23503':
      return new ValidationError(config.messages?.reference ?? 'A referenced record does not exist on this farm');
    case '23514':
    case '23502':
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
      return new ValidationError(`Invalid value: ${error.message}`);
    default:
      return error;
  }
};

export const notFound = config => new NotFoundError(`${config.label ?? 'Record'} not found`);

/** CSV with formula-injection protection for values opened in spreadsheet software. */
export const toCsv = (rows, fields) => {
  const escape = value => {
    if (value === null || value === undefined) return '';
    let text;
    if (value instanceof Date) text = value.toISOString();
    else text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = fields.map(field => escape(field.header ?? field.field)).join(',');
  const body = rows.map(row => fields.map(field => escape(row[field.field])).join(','));
  return [header, ...body].join('\n');
};
