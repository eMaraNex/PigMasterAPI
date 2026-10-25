import { describe, expect, test } from '@jest/globals';
import {
  actionPermission,
  buildPermissionCatalog,
  expandPermissions,
  hasPermission,
  sanitisePermissions,
} from '../src/business/permissions.js';

const configs = {
  farms: { tenant: { type: 'owner', field: 'created_by' }, table: 'farms', label: 'Farm' },
  pigs: {
    tenant: { type: 'farm', field: 'farm_id' }, table: 'pigs', label: 'Pig',
    actions: [{ method: 'post', path: '/transfer/:id', permission: 'update' }],
  },
  removals: { tenant: { type: 'farm', field: 'farm_id' }, table: 'removal_records', label: 'Removal', operations: ['list', 'get', 'export'] },
  reports: {
    tenant: { type: 'farm', field: 'farm_id' }, label: 'Report',
    actions: [{ method: 'get', path: '/summary' }, { method: 'get', path: '/export', permission: 'export' }],
  },
};

describe('farm permissions', () => {
  test('wildcards match objects and operations', () => {
    expect(hasPermission(['*'], 'pigs', 'delete')).toBe(true);
    expect(hasPermission(['pigs.*'], 'pigs', 'export')).toBe(true);
    expect(hasPermission(['*.read'], 'earnings', 'read')).toBe(true);
    expect(hasPermission(['*.read'], 'earnings', 'create')).toBe(false);
    expect(hasPermission(['pigs.read'], 'pens', 'read')).toBe(false);
    expect(hasPermission(undefined, 'pigs', 'read')).toBe(false);
  });

  test('actions default to read for GET and create for writes', () => {
    expect(actionPermission({ method: 'get' })).toBe('read');
    expect(actionPermission({ method: 'post' })).toBe('create');
    expect(actionPermission({ method: 'post', permission: 'update' })).toBe('update');
  });

  test('catalog lists only farm-scoped objects with the operations they expose', () => {
    const catalog = buildPermissionCatalog(configs);
    const objects = catalog.groups.flatMap(group => group.objects);
    expect(objects.map(object => object.key).sort()).toEqual(['pigs', 'removals', 'reports']);
    expect(objects.find(object => object.key === 'removals').operations).toEqual(['read', 'export']);
    expect(objects.find(object => object.key === 'reports').operations).toEqual(['read', 'export']);
  });

  test('sanitise drops unknown keys and expand resolves wildcards', () => {
    const catalog = buildPermissionCatalog(configs);
    expect(sanitisePermissions(['pigs.read', 'bogus.read', 'pigs.read', 'farms.update'], catalog)).toEqual(['pigs.read']);
    expect(sanitisePermissions(['*', 'pigs.read'], catalog)).toEqual(['*']);
    expect(expandPermissions(['*.export'], catalog)).toEqual(['pigs.export', 'removals.export', 'reports.export']);
  });
});
