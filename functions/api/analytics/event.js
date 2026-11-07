import { error, json, isSameOrigin, readJson, requireDatabase } from '../../../functions-shared/http.js';
import { enforceRateLimit } from '../../../functions-shared/rate-limit.js';

const EVENTS = new Set(['calculator_use', 'scenario_export', 'scenario_import', 'report_print', 'pro_interest_join']);
const CATEGORIES = new Set(['housing', 'saving', 'debt', 'crossborder', 'planning', 'general']);

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  try {
    const rate = await enforceRateLimit(env, request, 'site-event', 120, 900);
    if (!rate.allowed) return error('Event limit reached. Please retry later.', 429, { 'Retry-After': String(rate.retryAfter) });
    const body = await readJson(request, 2048);
    const eventName = String(body.event || '').trim();
    const category = String(body.category || 'general').trim().toLowerCase();
    const market = String(body.market || 'US').trim().toUpperCase();
    if (!EVENTS.has(eventName)) return error('Unsupported analytics event.', 400);
    if (!CATEGORIES.has(category)) return error('Unsupported analytics category.', 400);
    if (!['US', 'CA'].includes(market)) return error('Unsupported market.', 400);
    const db = requireDatabase(env);
    const today = new Date().toISOString().slice(0, 10);
    await db.prepare(`
      INSERT INTO daily_site_events (event_date, event_name, category, market, event_count)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(event_date, event_name, category, market)
      DO UPDATE SET event_count = event_count + 1
    `).bind(today, eventName, category, market).run();
    return json({ ok: true }, 202);
  } catch (err) {
    console.error('Site event error:', err.message);
    return err.message.startsWith('Request body') ? error(err.message, 400) : error('Event could not be recorded.', 503);
  }
}
