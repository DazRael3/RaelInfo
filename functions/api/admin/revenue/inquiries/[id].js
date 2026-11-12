import { json, error, readJson, requireDatabase, isSameOrigin } from '../../../../../functions-shared/http.js';
import { isRevenueAdmin } from '../../../../../functions-shared/admin.js';

function authorize(request, env) {
  if (!isRevenueAdmin(request, env)) {
    return error('Unauthorized.', 401, { 'WWW-Authenticate': 'Bearer' });
  }
  if (!isSameOrigin(request)) {
    return error('Request origin not allowed.', 403);
  }
  return null;
}

export async function onRequestPatch({ request, env, params }) {
  const denied = authorize(request, env);
  if (denied) return denied;

  try {
    const body = await readJson(request, 1024);
    const id = String(params.id || '').trim();
    if (!id) return error('Inquiry ID is required.', 400);

    const db = requireDatabase(env);

    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      if (Object.prototype.hasOwnProperty.call(body, 'legalHold')) {
        return error('Update status and legal hold separately.', 400);
      }
      const status = String(body.status || '').toLowerCase();
      if (!['new', 'reviewing', 'contacted', 'closed'].includes(status)) {
        return error('Invalid inquiry status.', 400);
      }
      const result = await db.prepare(
        'UPDATE business_inquiries SET status = ? WHERE id = ?'
      ).bind(status, id).run();
      if (!result.meta?.changes) {
        const existing = await db.prepare(
          'SELECT id FROM business_inquiries WHERE id = ?'
        ).bind(id).first();

        if (!existing) return error('Inquiry not found.', 404);
      }
      return json({ ok: true, status });
    }

    if (typeof body.legalHold !== 'boolean') {
      return error('A legalHold boolean is required.', 400);
    }

    let reason = '';
    if (body.legalHold) {
      reason = String(body.reason || '').trim();
      if (reason.length < 5 || reason.length > 500) {
        return error('A documented legal-hold reason of 5 to 500 characters is required.', 400);
      }
    }

    const result = await db.prepare(
      'UPDATE business_inquiries SET legal_hold = ?, legal_hold_reason = ? WHERE id = ?'
    ).bind(body.legalHold ? 1 : 0, reason, id).run();

    if (!result.meta?.changes) {
        const existing = await db.prepare(
          'SELECT id FROM business_inquiries WHERE id = ?'
        ).bind(id).first();

        if (!existing) return error('Inquiry not found.', 404);
      }
    return json({ ok: true, legalHold: body.legalHold });
  } catch (err) {
    console.error('Inquiry update failed:', err.message);
    return error('Unable to update inquiry.', 503);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const denied = authorize(request, env);
  if (denied) return denied;

  try {
    const id = String(params.id || '').trim();
    if (!id) return error('Inquiry ID is required.', 400);

    const db = requireDatabase(env);
    const result = await db.prepare(
      'DELETE FROM business_inquiries WHERE id = ? AND legal_hold = 0'
    ).bind(id).run();

    if (result.meta?.changes) return json({ ok: true, deleted: true });

    const existing = await db.prepare(
      'SELECT legal_hold AS legalHold FROM business_inquiries WHERE id = ?'
    ).bind(id).first();

    if (!existing) return error('Inquiry not found.', 404);
    if (Number(existing.legalHold) === 1) {
      return error('This inquiry is protected by a legal hold.', 409);
    }
    return error('Inquiry could not be deleted.', 409);
  } catch (err) {
    console.error('Inquiry deletion failed:', err.message);
    return error('Unable to delete inquiry.', 503);
  }
}