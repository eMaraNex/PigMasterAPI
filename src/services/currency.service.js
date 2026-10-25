import axios from 'axios';
import logger from '../middleware/logger.js';

const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

/**
 * Exchange rates for `base`. Uses ExchangeRate-API with EXCHANGE_RATE_API_KEY when set,
 * otherwise its free no-key endpoint (open.er-api.com, refreshed daily). Rates are
 * cached for six hours; if the provider is down the last good rates are served.
 */
export const getExchangeRates = async (base = 'USD') => {
  const cached = cache.get(base);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.value;

  const key = process.env.EXCHANGE_RATE_API_KEY?.trim();
  const url = key
    ? `https://v6.exchangerate-api.com/v6/${encodeURIComponent(key)}/latest/${base}`
    : `https://open.er-api.com/v6/latest/${base}`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const rates = data.conversion_rates ?? data.rates;
    if (data.result !== 'success' || !rates) throw new Error(data['error-type'] ?? 'invalid response');
    const value = {
      base,
      rates,
      source: key ? 'exchangerate-api.com' : 'open.er-api.com',
      updated_at: data.time_last_update_utc ? new Date(data.time_last_update_utc).toISOString() : new Date().toISOString(),
    };
    cache.set(base, { value, fetchedAt: Date.now() });
    return value;
  } catch (error) {
    logger.warn(`Exchange-rate fetch failed (${key ? 'keyed' : 'free'} endpoint): ${error.message}`);
    if (cached) return { ...cached.value, stale: true };
    // Last resort so amounts still render: USD and KES from configuration.
    const kes = Number(process.env.USD_TO_KES_RATE) || 130;
    return {
      base: 'USD',
      rates: { USD: 1, KES: kes },
      source: 'fallback',
      stale: true,
      updated_at: new Date().toISOString(),
    };
  }
};
