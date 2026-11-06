const encoder = new TextEncoder();

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(JSON.stringify(data), { status, headers });
}

export function error(message, status = 400, extraHeaders = {}) {
  return json({ error: message }, status, extraHeaders);
}

export async function readJson(request, maxBytes = 16_384) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('Request body is too large.');
  const text = await request.text();
  if (encoder.encode(text).byteLength > maxBytes) throw new Error('Request body is too large.');
  try {
    const data = JSON.parse(text || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

export function isSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) return false;
  } catch {
    return false;
  }
  return request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}

export function cookieValue(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); }
      catch { return null; }
    }
  }
  return null;
}

export function setCookies(response, cookies = []) {
  if (!cookies.length) return response;
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return base64Url(new Uint8Array(digest));
}

export function constantTimeEqual(a, b) {
  const left = encoder.encode(String(a || ''));
  const right = encoder.encode(String(b || ''));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function sessionCookieHeaders(request, tokens, csrfToken) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const accessAge = Math.max(60, Math.min(Number(tokens.expires_in) || 3600, 86_400));
  const refreshAge = 60 * 60 * 24 * 30;
  return [
    `raelinfo_access=${encodeURIComponent(tokens.access_token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${accessAge}${secure}`,
    `raelinfo_refresh=${encodeURIComponent(tokens.refresh_token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${refreshAge}${secure}`,
    `raelinfo_csrf=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Strict; Max-Age=${refreshAge}${secure}`
  ];
}

export function clearSessionCookieHeaders(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return [
    `raelinfo_access=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `raelinfo_refresh=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `raelinfo_csrf=; Path=/; SameSite=Strict; Max-Age=0${secure}`
  ];
}

export function csrfCookieHeader(request, token) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `raelinfo_csrf=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=2592000${secure}`;
}

export async function newCsrfToken() {
  return randomToken(32);
}

export function checkCsrf(request) {
  const cookie = cookieValue(request, 'raelinfo_csrf');
  const header = request.headers.get('X-CSRF-Token');
  return Boolean(cookie && header && constantTimeEqual(cookie, header));
}

export function requireDatabase(env) {
  if (!env.DB) throw new Error('Database binding DB is not configured.');
  return env.DB;
}

export async function ensureUserProfile(db, user) {
  if (!user?.id || !user?.email) throw new Error('Authenticated user profile is incomplete.');
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO users (id, email, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at
  `).bind(user.id, String(user.email).toLowerCase(), now, now).run();
}
