import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CONFIG, KEYS } from './config.js';

const app = express();
const scrypt = promisify(crypto.scrypt);
const PUBLIC_DIR = fileURLToPath(CONFIG.publicDir);
const DATA_DIR = fileURLToPath(CONFIG.dataDir);
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_COOKIE = 'raelinfo_session';
const SESSION_TTL_MS = CONFIG.sessionDays * 24 * 60 * 60 * 1000;
const cache = new Map();
const sessions = new Map();
let userStore = { users: {} };
let userWriteQueue = Promise.resolve();
let secNextAllowedAt = 0;

app.disable('x-powered-by');
if (CONFIG.nodeEnv === 'production') app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '100kb', strict: true }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 240,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait and try again.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' }
});
app.use('/api', apiLimiter);

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function setSessionCookie(res, token) {
  const secure = CONFIG.nodeEnv === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`);
}

function clearSessionCookie(res) {
  const secure = CONFIG.nodeEnv === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function checkSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (CONFIG.allowedOrigin && origin) {
    try {
      if (new URL(origin).origin !== new URL(CONFIG.allowedOrigin).origin) return sendError(res, 403, 'Request origin not allowed.');
    } catch {
      return sendError(res, 403, 'Invalid request origin.');
    }
  } else if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return sendError(res, 403, 'Cross-origin request rejected.');
    } catch {
      return sendError(res, 403, 'Invalid request origin.');
    }
  }
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return sendError(res, 403, 'Cross-site request rejected.');
  next();
}

function requireAuth(req, res, next) {
  const token = getCookie(req, SESSION_COOKIE);
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    clearSessionCookie(res);
    return sendError(res, 401, 'Please sign in to continue.');
  }
  const user = userStore.users[session.username];
  if (!user || user.id !== session.userId) return sendError(res, 401, 'Your session is no longer valid. Please sign in again.');
  req.user = user;
  req.session = session;
  next();
}

function requireCsrf(req, res, next) {
  const supplied = req.get('x-csrf-token');
  if (!supplied || !safeEqualText(supplied, req.session.csrfToken)) return sendError(res, 403, 'Security token expired. Refresh the page and try again.');
  next();
}

function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    csrfToken,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  setSessionCookie(res, token);
  return csrfToken;
}

function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

async function saveUserStore() {
  const snapshot = JSON.stringify(userStore, null, 2);
  userWriteQueue = userWriteQueue.then(async () => {
    const tempFile = `${USERS_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tempFile, `${snapshot}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tempFile, USERS_FILE);
  });
  return userWriteQueue;
}

async function loadUserStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    userStore = parsed && parsed.users && typeof parsed.users === 'object' ? parsed : { users: {} };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    userStore = { users: {} };
    await saveUserStore();
  }
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64);
  return { salt, passwordHash: Buffer.from(derived).toString('hex') };
}

async function verifyPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false;
  const derived = Buffer.from(await scrypt(password, user.salt, 64));
  const expected = Buffer.from(user.passwordHash, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs || 12_000),
    headers: { Accept: 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Upstream provider returned HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) throw new Error('Upstream provider returned a non-JSON response');
  return response.json();
}

async function cachedValue(key, ttlMs, loader) {
  const existing = cache.get(key);
  if (existing && Date.now() - existing.savedAt < ttlMs) {
    return { data: existing.data, cached: true, stale: false, savedAt: existing.savedAt };
  }
  try {
    const data = await loader();
    const savedAt = Date.now();
    cache.set(key, { data, savedAt });
    return { data, cached: false, stale: false, savedAt };
  } catch (error) {
    if (existing) return { data: existing.data, cached: true, stale: true, savedAt: existing.savedAt, error };
    throw error;
  }
}

function setCacheHeaders(res, result) {
  res.set('X-RaelInfo-Cache', result.stale ? 'stale' : result.cached ? 'hit' : 'miss');
  res.set('X-RaelInfo-Data-Time', new Date(result.savedAt).toISOString());
  if (result.stale) res.set('Warning', '110 - "Response is stale"');
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStock(symbol, price, source, extras = {}) {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) throw new Error(`${source} returned no usable quote`);
  return {
    symbol,
    price: numericPrice,
    currency: extras.currency || 'USD',
    change: optionalNumber(extras.change),
    changePercent: optionalNumber(extras.changePercent),
    volume: optionalNumber(extras.volume),
    asOf: extras.asOf || null,
    source,
    quoteType: extras.quoteType || 'Provider quote; check source timestamp and terms before relying on it.'
  };
}

const stockProviders = {
  async alpha(symbol) {
    if (!KEYS.alpha) throw new Error('Alpha Vantage key not configured');
    const url = new URL('https://www.alphavantage.co/query');
    url.search = new URLSearchParams({ function: 'GLOBAL_QUOTE', symbol, apikey: KEYS.alpha });
    const data = await fetchJson(url);
    if (data.Note || data.Information || data['Error Message']) throw new Error(data.Note || data.Information || data['Error Message']);
    const q = data['Global Quote'] || {};
    return normalizeStock(symbol, q['05. price'], 'Alpha Vantage', {
      change: q['09. change'], changePercent: String(q['10. change percent'] || '').replace('%', ''),
      volume: q['06. volume'], asOf: q['07. latest trading day'], quoteType: 'Global Quote; default free endpoint is end-of-day, not real-time.'
    });
  },
  async fmp(symbol) {
    if (!KEYS.fmp) throw new Error('FMP key not configured');
    const url = new URL('https://financialmodelingprep.com/stable/quote');
    url.search = new URLSearchParams({ symbol, apikey: KEYS.fmp });
    const data = await fetchJson(url);
    const q = Array.isArray(data) ? data[0] : null;
    return normalizeStock(symbol, q?.price, 'Financial Modeling Prep', {
      currency: q?.currency || 'USD', change: q?.change, changePercent: q?.changePercentage, volume: q?.volume,
      asOf: q?.timestamp ? new Date(Number(q.timestamp) * 1000).toISOString() : null,
      quoteType: 'FMP quote; availability and display rights depend on your plan.'
    });
  },
  async eod(symbol) {
    if (!KEYS.eod) throw new Error('EODHD key not configured');
    const eodSymbol = symbol.includes('.') ? symbol : `${symbol}.US`;
    const url = new URL(`https://eodhd.com/api/real-time/${encodeURIComponent(eodSymbol)}`);
    url.search = new URLSearchParams({ api_token: KEYS.eod, fmt: 'json' });
    const q = await fetchJson(url);
    return normalizeStock(symbol, q.close, 'EOD Historical Data', {
      currency: q.currency || 'USD', change: q.change, changePercent: q.change_p, volume: q.volume,
      asOf: q.timestamp ? new Date(Number(q.timestamp) * 1000).toISOString() : null,
      quoteType: 'EODHD real-time endpoint; free-plan access may be restricted.'
    });
  }
};

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'RaelInfo API',
    version: '2.0.0',
    time: new Date().toISOString(),
    providers: {
      crypto: 'CoinLore (public endpoint)',
      fx: 'Frankfurter (public endpoint)',
      news: 'GDELT DOC API (public endpoint)',
      stocks: Object.fromEntries(['alpha', 'fmp', 'eod'].map(name => [name, Boolean(KEYS[name])])),
      sec: Boolean(CONFIG.secUserAgent && CONFIG.secUserAgent.includes('@') && !CONFIG.secUserAgent.includes('example.com'))
    }
  });
});

// CoinLore supports multiple numeric coin IDs in one ticker request.
app.get('/api/crypto', async (_req, res) => {
  try {
    const result = await cachedValue('crypto:btc-eth-sol', CONFIG.cacheTtl.crypto, async () => {
      const url = 'https://api.coinlore.net/api/ticker/?id=90,80,48543';
      const data = await fetchJson(url);
      if (!Array.isArray(data) || !data.length) throw new Error('CoinLore returned an empty market response');
      return data;
    });
    setCacheHeaders(res, result);
    if (result.stale) res.set('X-RaelInfo-Data-Status', 'stale');
    res.json(result.data);
  } catch (error) {
    console.error('Crypto provider error:', error.message);
    sendError(res, 502, 'Crypto market data is temporarily unavailable. Try again later.');
  }
});

app.get('/api/fx', async (req, res) => {
  const from = String(req.query.from || 'USD').toUpperCase();
  const to = String(req.query.to || 'CAD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to) return sendError(res, 400, 'Provide two different three-letter currency codes.');
  try {
    const result = await cachedValue(`fx:${from}:${to}`, CONFIG.cacheTtl.fx, async () => {
      const data = await fetchJson(`https://api.frankfurter.dev/v2/rate/${from.toLowerCase()}/${to.toLowerCase()}`);
      if (!data || !Number.isFinite(Number(data.rate)) || data.base !== from || data.quote !== to) throw new Error('Unexpected FX response');
      return data;
    });
    setCacheHeaders(res, result);
    res.json(result.data);
  } catch (error) {
    console.error('FX provider error:', error.message);
    sendError(res, 502, 'Exchange-rate data is temporarily unavailable.');
  }
});

app.get('/api/stock', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) return sendError(res, 400, 'Enter a valid stock ticker (letters, numbers, period or hyphen).');
  const available = CONFIG.stockProviderOrder.filter(name => stockProviders[name] && KEYS[name]);
  if (!available.length) return sendError(res, 503, 'Stock quotes are not configured. Add at least one stock-provider key to .env and restart the server.');
  try {
    const result = await cachedValue(`stock:${symbol}`, CONFIG.cacheTtl.stock, async () => {
      const failures = [];
      for (const providerName of available) {
        try { return await stockProviders[providerName](symbol); }
        catch (error) { failures.push(`${providerName}: ${error.message}`); }
      }
      throw new Error(failures.join('; ') || 'All stock providers failed');
    });
    setCacheHeaders(res, result);
    res.json({ ...result.data, stale: result.stale, dataRetrievedAt: new Date(result.savedAt).toISOString() });
  } catch (error) {
    console.error(`Stock quote failed for ${symbol}:`, error.message);
    sendError(res, 502, 'No configured stock provider returned a usable quote. Check keys, plan limits and symbol format.');
  }
});

app.get('/api/news', async (req, res) => {
  const query = String(req.query.q || 'business OR finance OR stock market').trim().slice(0, 120);
  if (!query || /[<>\u0000-\u001f]/.test(query)) return sendError(res, 400, 'Enter a valid news search phrase.');
  try {
    const result = await cachedValue(`news:${query.toLowerCase()}`, CONFIG.cacheTtl.news, async () => {
      const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
      url.search = new URLSearchParams({ query, mode: 'ArtList', format: 'json', maxrecords: '15', timespan: '7d', sort: 'datedesc' });
      const data = await fetchJson(url, { headers: { 'User-Agent': 'RaelInfo/2.0 (news dashboard)' } });
      const docs = Array.isArray(data.articles) ? data.articles : [];
      return docs.map(item => ({
        title: String(item.title || '').slice(0, 400),
        url: String(item.url || ''),
        source: String(item.domain || item.source || ''),
        publishedAt: item.seendate || item.datetime || null,
        language: item.language || null
      })).filter(item => item.title && /^https?:\/\//i.test(item.url));
    });
    setCacheHeaders(res, result);
    res.json({ query, articles: result.data, stale: result.stale, retrievedAt: new Date(result.savedAt).toISOString(), source: 'GDELT DOC API' });
  } catch (error) {
    console.error('News provider error:', error.message);
    sendError(res, 502, 'Business news is temporarily unavailable. Please retry in a few minutes.');
  }
});

async function waitForSecSlot() {
  const now = Date.now();
  const wait = Math.max(0, secNextAllowedAt - now);
  secNextAllowedAt = Math.max(now, secNextAllowedAt) + 1100;
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
}

app.get('/api/filings', async (req, res) => {
  const cikInput = String(req.query.cik || '').trim();
  if (!/^\d{1,10}$/.test(cikInput)) return sendError(res, 400, 'Enter a SEC CIK containing 1 to 10 digits.');
  if (!CONFIG.secUserAgent || !CONFIG.secUserAgent.includes('@') || CONFIG.secUserAgent.includes('example.com')) {
    return sendError(res, 503, 'SEC filings are disabled until SEC_USER_AGENT contains your application name and a real contact email in .env.');
  }
  const cik = cikInput.padStart(10, '0');
  try {
    const result = await cachedValue(`sec:${cik}`, CONFIG.cacheTtl.filings, async () => {
      await waitForSecSlot();
      const data = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, {
        headers: { 'User-Agent': CONFIG.secUserAgent, 'Accept-Encoding': 'gzip, deflate' }
      });
      const recent = data?.filings?.recent || {};
      const forms = recent.form || [];
      const dates = recent.filingDate || [];
      const accessions = recent.accessionNumber || [];
      const documents = recent.primaryDocument || [];
      const descriptions = recent.primaryDocDescription || [];
      const filings = forms.slice(0, 30).map((form, index) => {
        const accession = accessions[index] || '';
        const document = documents[index] || '';
        const cikPath = String(Number(cik));
        const url = accession && document ? `https://www.sec.gov/Archives/edgar/data/${cikPath}/${accession.replaceAll('-', '')}/${encodeURIComponent(document)}` : '';
        return { form, filingDate: dates[index] || '', accessionNumber: accession, description: descriptions[index] || '', url };
      });
      return { cik, companyName: data.name || '', tickers: data.tickers || [], exchanges: data.exchanges || [], filings };
    });
    setCacheHeaders(res, result);
    res.json({ ...result.data, stale: result.stale, retrievedAt: new Date(result.savedAt).toISOString() });
  } catch (error) {
    console.error('SEC provider error:', error.message);
    sendError(res, 502, 'SEC filing data is temporarily unavailable. Check the CIK and try again later.');
  }
});

// Authentication: password hashes use scrypt; only an opaque HttpOnly session cookie reaches the browser.
app.post('/api/auth/register', authLimiter, checkSameOrigin, async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[a-z0-9._-]{3,24}$/.test(username)) return sendError(res, 400, 'Username must be 3–24 characters and use letters, numbers, dots, underscores or hyphens.');
  if (['__proto__', 'constructor', 'prototype'].includes(username)) return sendError(res, 400, 'That username is reserved. Choose another username.');
  if (password.length < 12 || password.length > 200) return sendError(res, 400, 'Password must be at least 12 characters (maximum 200).');
  if (userStore.users[username]) return sendError(res, 409, 'That username is already registered.');
  const { salt, passwordHash } = await hashPassword(password);
  // Re-check after the async hash so simultaneous registrations cannot overwrite an account.
  if (userStore.users[username]) return sendError(res, 409, 'That username is already registered.');
  const user = {
    id: crypto.randomUUID(), username, salt, passwordHash,
    createdAt: new Date().toISOString(), portfolio: []
  };
  userStore.users[username] = user;
  await saveUserStore();
  const csrfToken = createSession(res, user);
  res.status(201).json({ ok: true, user: publicUser(user), csrfToken });
});

app.post('/api/auth/login', authLimiter, checkSameOrigin, async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = userStore.users[username];
  if (!user || !(await verifyPassword(password, user))) return sendError(res, 401, 'Username or password is incorrect.');
  const csrfToken = createSession(res, user);
  res.json({ ok: true, user: publicUser(user), csrfToken });
});

app.get('/api/auth/me', (req, res) => {
  const token = getCookie(req, SESSION_COOKIE);
  const session = token ? sessions.get(token) : null;
  const user = session && session.expiresAt > Date.now() ? userStore.users[session.username] : null;
  if (!user) {
    if (token) { sessions.delete(token); clearSessionCookie(res); }
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true, user: publicUser(user), csrfToken: session.csrfToken });
});

app.post('/api/auth/logout', checkSameOrigin, requireAuth, requireCsrf, (req, res) => {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/delete', checkSameOrigin, requireAuth, requireCsrf, async (req, res) => {
  const password = String(req.body?.password || '');
  if (!(await verifyPassword(password, req.user))) return sendError(res, 401, 'Password confirmation did not match.');
  delete userStore.users[req.user.username];
  await saveUserStore();
  const token = getCookie(req, SESSION_COOKIE);
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/portfolio', requireAuth, (req, res) => {
  res.json({ items: req.user.portfolio || [] });
});

app.post('/api/portfolio/add', checkSameOrigin, requireAuth, requireCsrf, async (req, res) => {
  const symbol = String(req.body?.symbol || '').trim().toUpperCase();
  const shares = Number(req.body?.shares);
  const averageCost = Number(req.body?.averageCost);
  const currency = String(req.body?.currency || 'USD').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) return sendError(res, 400, 'Enter a valid ticker symbol.');
  if (!Number.isFinite(shares) || shares <= 0 || shares > 1_000_000_000) return sendError(res, 400, 'Shares must be greater than zero and within the supported range.');
  if (!Number.isFinite(averageCost) || averageCost < 0 || averageCost > 1_000_000_000) return sendError(res, 400, 'Average cost must be zero or a positive amount.');
  if (!['USD', 'CAD'].includes(currency)) return sendError(res, 400, 'Currency must be USD or CAD.');
  if (!Array.isArray(req.user.portfolio)) req.user.portfolio = [];
  if (req.user.portfolio.length >= 100) return sendError(res, 400, 'Portfolio limit reached (100 positions).');
  const item = { id: crypto.randomUUID(), symbol, shares, averageCost, currency, createdAt: new Date().toISOString() };
  req.user.portfolio.push(item);
  await saveUserStore();
  res.status(201).json({ ok: true, item });
});

app.delete('/api/portfolio/:id', checkSameOrigin, requireAuth, requireCsrf, async (req, res) => {
  const before = req.user.portfolio || [];
  const next = before.filter(item => item.id !== req.params.id);
  if (next.length === before.length) return sendError(res, 404, 'Portfolio position not found.');
  req.user.portfolio = next;
  await saveUserStore();
  res.json({ ok: true });
});

// Static content is deliberately served only from /public. data/users.json and .env are outside this root.
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: CONFIG.nodeEnv === 'production' ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith(`${path.sep}sw.js`)) res.setHeader('Cache-Control', 'no-cache');
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return sendError(res, 404, 'API endpoint not found.');
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled server error:', error);
  if (res.headersSent) return;
  sendError(res, 500, 'An unexpected server error occurred.');
});

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
  for (const [key, item] of cache) if (now - item.savedAt > 24 * 60 * 60 * 1000) cache.delete(key);
}, 15 * 60 * 1000);
cleanupTimer.unref();

await loadUserStore();
app.listen(CONFIG.port, () => {
  console.log(`RaelInfo API running on ${CONFIG.appBaseUrl} (port ${CONFIG.port})`);
  console.log('Stock quote providers enabled:', CONFIG.stockProviderOrder.filter(name => KEYS[name]).join(', ') || 'none');
  console.log('SEC filings enabled:', Boolean(CONFIG.secUserAgent && CONFIG.secUserAgent.includes('@') && !CONFIG.secUserAgent.includes('example.com')));
});
