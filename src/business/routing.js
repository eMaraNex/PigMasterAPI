import express from 'express';
import { pool } from '../config/database.js';
import authMiddleware from '../middleware/auth.middleware.js';
import { requireAdmin, requireAdminRoles } from '../middleware/admin.middleware.js';
import { ForbiddenError } from '../middleware/errors.js';
import { requireActiveSubscription } from '../middleware/subscription.middleware.js';
import { BaseBusinessLogic } from './base.js';
import { isUuid } from './helpers.js';
import { farmObjectConfigs } from './object-config.js';
import { adminObjectConfigs } from './admin-object-config.js';

const ALL_OPERATIONS = ['list', 'get', 'create', 'update', 'delete', 'export'];
const enforcePlan = requireActiveSubscription();
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

/**
 * Resolves the farm a farmer request acts on: the X-Farm-Id header when given,
 * otherwise the user's active farm. Ownership is always verified server-side.
 */
export const farmContext = wrap(async (req, _res, next) => {
  const requested = req.get('x-farm-id');
  const candidate = requested || req.user.farm_id;
  if (!candidate) return next();
  if (!isUuid(candidate)) throw new ForbiddenError('Invalid farm');
  const { rows } = await pool.query(
    'SELECT id FROM farms WHERE id = $1 AND created_by = $2 AND is_deleted = 0',
    [candidate, req.user.id]
  );
  if (!rows.length) {
    if (requested) throw new ForbiddenError('You do not have access to this farm');
    return next();
  }
  req.farmId = rows[0].id;
  next();
});

const contextFrom = req => ({
  user: req.user,
  farmId: req.farmId,
  admin: req.admin,
  adminRole: req.adminRole,
  ip: req.ip,
  userAgent: req.get('user-agent'),
});

const listInput = req => (req.method === 'GET' ? req.query : { ...req.query, ...req.body });

/** Builds the router for one configured business object. */
export const generateRoutes = (objectKey, config, realm) => {
  const router = express.Router();
  // Objects without a table (e.g. reports) only expose their custom actions.
  const service = config.table ? new BaseBusinessLogic(objectKey, config) : null;
  const operations = new Set(config.table ? config.operations ?? ALL_OPERATIONS : []);

  if (realm === 'admin') {
    router.use(requireAdmin, requireAdminRoles(config.adminRoles));
  } else {
    router.use(authMiddleware, farmContext);
  }
  const writeGuards = realm === 'farm' && config.enforcePlan !== false ? [enforcePlan] : [];

  for (const action of config.actions ?? []) {
    router[action.method](action.path, ...(action.write ? writeGuards : []), wrap(async (req, res) => {
      const data = await action.handler(contextFrom(req), req, service);
      res.status(action.method === 'post' && action.write ? 201 : 200).json({ success: true, data });
    }));
  }

  if (operations.has('list')) {
    const list = wrap(async (req, res) => {
      res.json({ success: true, ...(await service.list(contextFrom(req), listInput(req))) });
    });
    router.get('/list', list);
    router.post('/list', list);
  }
  if (operations.has('get')) {
    router.get('/list/:id', wrap(async (req, res) => {
      res.json({ success: true, data: await service.getById(contextFrom(req), req.params.id) });
    }));
  }
  if (operations.has('create')) {
    router.post('/create', ...writeGuards, wrap(async (req, res) => {
      res.status(201).json({ success: true, message: `${config.label} created`, data: await service.create(contextFrom(req), req.body) });
    }));
  }
  if (operations.has('update')) {
    const update = wrap(async (req, res) => {
      res.json({ success: true, message: `${config.label} updated`, data: await service.update(contextFrom(req), req.params.id, req.body) });
    });
    router.put('/update/:id', ...writeGuards, update);
    router.patch('/update/:id', ...writeGuards, update);
  }
  if (operations.has('delete')) {
    router.delete('/delete/:id', ...writeGuards, wrap(async (req, res) => {
      res.json({ success: true, message: `${config.label} deleted`, data: await service.delete(contextFrom(req), req.params.id, req.body) });
    }));
  }
  if (operations.has('export')) {
    router.post('/export', wrap(async (req, res) => {
      const file = await service.export(contextFrom(req), listInput(req));
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('X-Export-Truncated', String(file.truncated));
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Truncated');
      res.send(file.body);
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
