/*
 * Farm permissions are "<object>.<operation>" keys derived from the business-object
 * configs, so every CRUD route and custom action is covered without a hand-kept list.
 *
 *   operations: read | create | update | delete | export
 *   wildcards:  "*" (everything), "pigs.*" (all of one object), "*.read" (one operation everywhere)
 *
 * Roles (and their permissions) are maintained by the platform team in the admin
 * dashboard; farm admins only assign roles to their team members.
 */

export const PERMISSION_OPERATIONS = ['read', 'create', 'update', 'delete', 'export'];

export const OPERATION_LABELS = {
  read: 'View',
  create: 'Add',
  update: 'Edit',
  delete: 'Delete',
  export: 'Export',
};

const OPERATION_VERBS = {
  read: 'view',
  create: 'add',
  update: 'edit',
  delete: 'delete',
  export: 'export',
};

// Groups shown in the permission editor, in display order.
const PERMISSION_GROUPS = [
  ['Farm setup', ['rows', 'pens']],
  ['Herd', ['pigs', 'piglets', 'pen_history', 'pig_transfers', 'removals']],
  ['Breeding', ['breeding_records']],
  ['Health', ['health_records']],
  ['Feeding', ['feeding_records', 'feed_stock', 'feeding_schedules']],
  ['Finance', ['earnings']],
  ['Insights', ['reports', 'alerts']],
  ['Team', ['team']],
];

const CRUD_TO_PERMISSION = { list: 'read', get: 'read', create: 'create', update: 'update', delete: 'delete', export: 'export' };
const DEFAULT_OPERATIONS = ['list', 'get', 'create', 'update', 'delete', 'export'];

// Area names for the permission editor ("Pigs", not "Pig").
const pluralLabel = label =>
  /(history|s)$/i.test(label) ? label : /[^aeiou]y$/i.test(label) ? `${label.slice(0, -1)}ies` : `${label}s`;

/** The permission a custom action needs: explicit, else GET = read and writes = create. */
export const actionPermission = action => action.permission ?? (action.method === 'get' ? 'read' : 'create');

/** True when the object is protected by farm roles (farm-scoped objects only). */
export const isPermissioned = config => config.tenant?.type === 'farm';

const operationsFor = config => {
  const granted = new Set();
  for (const operation of config.table ? config.operations ?? DEFAULT_OPERATIONS : []) {
    granted.add(CRUD_TO_PERMISSION[operation]);
  }
  for (const action of config.actions ?? []) granted.add(actionPermission(action));
  for (const extra of config.extraPermissions ?? []) granted.add(extra);
  return PERMISSION_OPERATIONS.filter(operation => granted.has(operation));
};

/**
 * Every permission the platform knows about, grouped for a permission editor.
 * Defaults describe farm roles; the admin dashboard passes its own objects and groups.
 * `extra` adds objects that are not business objects (e.g. the admin overview dashboard).
 */
export const buildPermissionCatalog = (configs, { include = isPermissioned, groups = PERMISSION_GROUPS, extra = {} } = {}) => {
  const all = { ...Object.fromEntries(Object.entries(configs).filter(([, config]) => include(config))), ...extra };
  const grouped = new Set(groups.flatMap(([, keys]) => keys));
  return {
    operations: PERMISSION_OPERATIONS.map(key => ({ key, label: OPERATION_LABELS[key] })),
    groups: [...groups, ['Other', Object.keys(all).filter(key => !grouped.has(key))]]
      .map(([label, keys]) => ({
        label,
        objects: keys
          .filter(key => all[key])
          .map(key => ({
            key,
            label: all[key].permissionLabel ?? pluralLabel(all[key].label),
            operations: all[key].permissionOperations ?? operationsFor(all[key]),
          })),
      }))
      .filter(group => group.objects.length),
  };
};

/** Whether a permission list (with wildcards) allows `operation` on `object`. */
export const hasPermission = (permissions, object, operation) =>
  Array.isArray(permissions) && permissions.some(permission =>
    permission === '*'
    || permission === `${object}.*`
    || permission === `*.${operation}`
    || permission === `${object}.${operation}`);

/** Expands wildcards into the explicit keys the catalog defines (used by the UIs). */
export const expandPermissions = (permissions, catalog) =>
  catalog.groups.flatMap(group => group.objects.flatMap(object =>
    object.operations
      .filter(operation => hasPermission(permissions, object.key, operation))
      .map(operation => `${object.key}.${operation}`)));

/** Drops unknown keys so a role can only ever hold permissions the catalog defines. */
export const sanitisePermissions = (permissions, catalog) => {
  if (permissions.includes('*')) return ['*'];
  const known = new Set(expandPermissions(['*'], catalog));
  return [...new Set(permissions.filter(permission => known.has(permission)))].sort();
};

export const permissionDeniedMessage = (roleName, operation, label) =>
  `Your role (${roleName}) does not allow you to ${OPERATION_VERBS[operation] ?? operation} ${label.toLowerCase()} records. Ask your farm admin for access.`;
