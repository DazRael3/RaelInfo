import { json, error, requireDatabase } from '../../functions-shared/http.js';
import { cachedJson, cacheHeaders } from '../../functions-shared/cache.js';
import { enforceRateLimitOrThrow } from '../../functions-shared/rate-limit.js';
import { getStockQuote } from '../../functions-shared/providers.js';

export async function onRequestGet({ request, env }) {
  const symbol = String(new URL(request.url).searchParams.get('symbol') || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) return error('Enter a valid stock ticker (letters, numbers, period or hyphen).', 400);
  try {
    requireDatabase(env);
    const result = await cachedJson(env, `stock:${symbol}`, 120, () => getStockQuote(symbol, env), 86_400, () => enforceRateLimitOrThrow(env, request, 'market-stock', 20, 60));
    return json({ ...result.data, stale: result.stale, dataRetrievedAt: new Date(result.savedAt * 1000).toISOString() }, 200, cacheHeaders(result));
  } catch (err) {
    if (err?.status === 429) {
      return error('Market data is being refreshed too frequently. Please retry shortly.', 429, {
        'Retry-After': String(err.retryAfter || 60)
      });
    }
    console.error(`Stock quote error for ${symbol}:`, err.message);
    if (err.message.includes('No stock provider is configured')) return error('Stock quotes are not configured. Add a provider API key and confirm commercial display rights.', 503);
    return error('No configured stock provider returned a usable quote. Check provider keys, plan limits and symbol format.', 502);
  }
}
