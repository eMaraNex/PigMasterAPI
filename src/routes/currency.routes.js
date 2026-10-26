import express from 'express';
import rateLimitMiddleware from '../middleware/rate-limit.middleware.js';
import { getExchangeRates } from '../services/currency.service.js';

const router = express.Router();

router.get('/rates', rateLimitMiddleware(30, 60 * 1000), async (req, res, next) => {
  try {
    const base = String(req.query.base ?? 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(base)) return res.status(400).json({ success: false, message: 'base must be a 3-letter currency code' });
    const data = await getExchangeRates(base);
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

export default router;
