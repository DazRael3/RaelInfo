import {
  cookieValue,
  sessionCookieHeaders,
  sha256Base64Url,
  setCookies,
  json,
  clearSessionCookieHeaders,
  requireDatabase,
  ensureUserProfile
} from './http.js';

function supabaseConfig(env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || '');
  if (!base || !key) throw new Error('Supabase Auth is not configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to Cloudflare Pages production variables.');
  const parsed = new URL(base);
  if (parsed.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS.');
  return { base, key };
}

async function authFetch(env, path, { method = 'GET', body, accessToken, admin = false } = {}) {
  const { base, key } = supabaseConfig(env);
  const adminKey = admin ? String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '') : '';
  if (admin && !adminKey) throw new Error('Account deletion is not enabled. Add SUPABASE_SECRET_KEY as a Cloudflare secret.');
  const apiKey = admin ? adminKey : key;
  const headers = {
    apikey: apiKey,
    Accept: 'application/json'
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (admin) headers.Authorization = `Bearer ${adminKey}`;
  else if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.msg || data.message || data.error_description || data.error || 'Authentication provider request failed.';
    const error = new Error(String(message).slice(0, 300));
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function registerWithSupabase(env, email, password, redirectTo) {
  const url = new URL('/auth/v1/signup', supabaseConfig(env).base);
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
  const { key } = supabaseConfig(env);
  const response = await fetch(url, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(12_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.msg || data.message || data.error_description || data.error || 'Account registration failed.';
    const err = new Error(String(message).slice(0, 300));
    err.status = response.status;
    throw err;
  }
  return data;
}

export async function signInWithSupabase(env, email, password) {
  return authFetch(env, '/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email, password }
  });
}


export async function recoverSupabasePassword(env, email, redirectTo) {
  const url = new URL('/auth/v1/recover', supabaseConfig(env).base);
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
  return authFetch(env, `${url.pathname}${url.search}`, { method: 'POST', body: { email } });
}

export async function updateSupabasePassword(env, accessToken, password) {
  return authFetch(env, '/auth/v1/user', { method: 'PUT', body: { password }, accessToken });
}

export async function refreshSupabaseSession(env, refreshToken) {
  return authFetch(env, '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: { refresh_token: refreshToken }
  });
}

export async function getSupabaseUser(env, accessToken) {
  return authFetch(env, '/auth/v1/user', { accessToken });
}

export async function signOutSupabase(env, accessToken) {
  try { await authFetch(env, '/auth/v1/logout?scope=local', { method: 'POST', accessToken }); }
  catch (err) { if (err.status !== 401) throw err; }
}

export async function deleteSupabaseUser(env, userId, accessToken) {
  const id = encodeURIComponent(userId);
  await authFetch(env, `/auth/v1/admin/users/${id}`, { method: 'DELETE', accessToken, admin: true });
}

export async function getAuthenticatedUser(request, env) {
  const accessToken = cookieValue(request, 'raelinfo_access');
  const refreshToken = cookieValue(request, 'raelinfo_refresh');
  let currentAccess = accessToken;
  let currentRefresh = refreshToken;
  let user = null;
  let cookies = [];
  let refreshed = false;

  if (currentAccess) {
    try {
      user = await getSupabaseUser(env, currentAccess);
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) throw err;
    }
  }

  if (!user && currentRefresh) {
    try {
      const tokens = await refreshSupabaseSession(env, currentRefresh);
      if (tokens.access_token && tokens.refresh_token && tokens.user?.id) {
        currentAccess = tokens.access_token;
        currentRefresh = tokens.refresh_token;
        user = tokens.user;
        const csrf = cookieValue(request, 'raelinfo_csrf') || await sha256Base64Url(crypto.randomUUID());
        cookies = sessionCookieHeaders(request, tokens, csrf);
        refreshed = true;
      }
    } catch (err) {
      if (err.status !== 400 && err.status !== 401) throw err;
    }
  }

  if (user?.id && user?.email) {
    const db = requireDatabase(env);
    await ensureUserProfile(db, user);
  }

  return { user, accessToken: currentAccess, refreshToken: currentRefresh, cookies, refreshed };
}

export async function withAuthCookies(response, auth) {
  return auth?.cookies?.length ? setCookies(response, auth.cookies) : response;
}

export function authUnavailableResponse(request) {
  return setCookies(json({ authenticated: false }), clearSessionCookieHeaders(request));
}

export function userForClient(user) {
  return user ? { id: user.id, email: user.email, createdAt: user.created_at || null } : null;
}
