import { json, error, readJson, requireDatabase } from '../../../../../functions-shared/http.js';
import { isRevenueAdmin } from '../../../../../functions-shared/admin.js';

export async function onRequestPatch({ request, env, params }) {
  if (!isRevenueAdmin(request, env)) return error('Unauthorized.', 401, { 'WWW-Authenticate': 'Bearer' });
  try {
    const body = await readJson(request, 1024);
    const status = String(body.status || '').toLowerCase();
    if (!['new', 'reviewing', 'contacted', 'closed'].includes(status)) return error('Invalid inquiry status.', 400);
    const db = requireDatabase(env);
    const result = await db.prepare('UPDATE business_inquiries SET status = ? WHERE id = ?')
      .bind(status, String(params.id || '')).run();
    if (!result.meta?.changes) return error('Inquiry not found.', 404);
    return json({ ok: true });
  } catch (err) {
    console.error('Inquiry status update failed:', err.message);
    return error('Unable to update inquiry.', 503);
  }
}
