import express from 'express';
import authMiddleware from '../middleware/auth.middleware.js';
import { requireAdmin, requireAdminPermission } from '../middleware/admin.middleware.js';
import { ForbiddenError } from '../middleware/errors.js';
import { requireActiveSubscription } from '../middleware/subscription.middleware.js';
import { BaseBusinessLogic } from './base.js';
import { isUuid } from './helpers.js';
import { loadFarmAccess } from './farm-access.js';
import { actionPermission, hasPermission, isPermissioned, permissionDeniedMessage } from './permissions.js';
import { farmObjectConfigs } from './object-config.js';
import { adminObjectConfigs } from './admin-object-config.js';

const ALL_OPERATIONS = ['list', 'get', 'create', 'update', 'delete', 'export'];
const enforcePlan = requireActiveSubscription();
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

/**
 * Resolves the farm a farmer request acts on: the X-Farm-Id header when given,
 * otherwise the user's active farm. Access (owner or active team member) is always
 * verified server-side, and the farm's plan replaces the caller's own plan.
 */
export const farmContext = wrap(async (req, _res, next) => {
  const requested = req.get('x-farm-id');
  const candidate = requested || req.user.farm_id;
  if (!candidate) return next();
  if (!isUuid(candidate)) throw new ForbiddenError('Invalid farm');
  const access = await loadFarmAccess(req.user.id, candidate);
  if (!access) {
    if (requested) throw new ForbiddenError('You do not have access to this farm');
    return next();
  }
  req.farmId = access.farmId;
  req.farmAccess = access;
  req.accessControl = access.accessControl;
  next();
});

/** Rejects the request unless the caller's farm role grants `operation` on the object. */
const requirePermission = (objectKey, config, operation) => (req, _res, next) => {
  // Without a farm the engine itself answers "Create or select a farm first".
  if (!req.farmAccess || hasPermission(req.farmAccess.permissions, objectKey, operation)) return next();
  next(new ForbiddenError(permissionDeniedMessage(req.farmAccess.roleName, operation, config.label)));
};

const contextFrom = req => ({
  user: req.user,
  farmId: req.farmId,
  farmAccess: req.farmAccess,
  admin: req.admin,
  adminRole: req.adminRole,
  ip: req.ip,
  userAgent: req.get('user-agent'),
});

/** Sends an export file ({ filename, contentType, body, truncated }) as a download. */
const sendFile = (res, file) => {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('X-Export-Truncated', String(Boolean(file.truncated)));
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Truncated');
  res.send(file.body);
};

const listInput = req => (req.method === 'GET' ? req.query : { ...req.query, ...req.body });

/** Builds the router for one configured business object. */
export const generateRoutes = (objectKey, config, realm) => {
  const router = express.Router();
  // Objects without a table (e.g. reports) only expose their custom actions.
  const service = config.table ? new BaseBusinessLogic(objectKey, config) : null;
  const operations = new Set(config.table ? config.operations ?? ALL_OPERATIONS : []);

  if (realm === 'admin') {
    router.use(requireAdmin);
  } else {
    router.use(authMiddleware, farmContext);
  }
  const writeGuards = realm === 'farm' && config.enforcePlan !== false ? [enforcePlan] : [];
  // Farm routes check the farm role; admin routes check the admin role. Both are in-memory checks.
  const can = operation => {
    if (realm === 'admin') return [requireAdminPermission(objectKey, operation)];
    return isPermissioned(config) ? [requirePermission(objectKey, config, operation)] : [];
  };

  for (const action of config.actions ?? []) {
    router[action.method](action.path, ...can(actionPermission(action)), ...(action.write ? writeGuards : []), wrap(async (req, res) => {
      const data = await action.handler(contextFrom(req), req, service);
      if (action.download) return sendFile(res, data);
      res.status(action.method === 'post' && action.write ? 201 : 200).json({ success: true, data });
    }));
  }

  if (operations.has('list')) {
    const list = wrap(async (req, res) => {
      res.json({ success: true, ...(await service.list(contextFrom(req), listInput(req))) });
    });
    router.get('/list', ...can('read'), list);
    router.post('/list', ...can('read'), list);
  }
  if (operations.has('get')) {
    router.get('/list/:id', ...can('read'), wrap(async (req, res) => {
      res.json({ success: true, data: await service.getById(contextFrom(req), req.params.id) });
    }));
  }
  if (operations.has('create')) {
    router.post('/create', ...can('create'), ...writeGuards, wrap(async (req, res) => {
      res.status(201).json({ success: true, message: `${config.label} created`, data: await service.create(contextFrom(req), req.body) });
    }));
  }
  if (operations.has('update')) {
    const update = wrap(async (req, res) => {
      res.json({ success: true, message: `${config.label} updated`, data: await service.update(contextFrom(req), req.params.id, req.body) });
    });
    router.put('/update/:id', ...can('update'), ...writeGuards, update);
    router.patch('/update/:id', ...can('update'), ...writeGuards, update);
  }
  if (operations.has('delete')) {
    router.delete('/delete/:id', ...can('delete'), ...writeGuards, wrap(async (req, res) => {
      res.json({ success: true, message: `${config.label} deleted`, data: await service.delete(contextFrom(req), req.params.id, req.body) });
    }));
  }
  if (operations.has('export')) {
    router.post('/export', ...can('export'), wrap(async (req, res) => {
      sendFile(res, await service.export(contextFrom(req), listInput(req)));
    }));
  }
  return router;
};

/** Mounts every configured object: farm objects at /<path>, admin objects at /admin/<path>. */
export const registerBusinessRoutes = apiRouter => {
  for (const [key, config] of Object.entries(farmObjectConfigs)) {
    apiRouter.use(`/${config.path}`, generateRoutes(key, config, 'farm'));
  }
  for (const [key, config] of Object.entries(adminObjectConfigs)) {
    apiRouter.use(`/admin/${config.path}`, generateRoutes(key, config, 'admin'));
  }
};
