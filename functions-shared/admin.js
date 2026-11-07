import { constantTimeEqual } from './http.js';

export function isRevenueAdmin(request, env) {
  const expected = String(env.RAELINFO_ADMIN_TOKEN || '');
  const supplied = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (expected.length < 32 || !supplied) return false;
  return constantTimeEqual(expected, supplied);
}
