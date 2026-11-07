import { loadNews } from './news.js';
import { loadFilings } from './filings.js';
import { initPortfolio, setPortfolioAuth } from './portfolio.js';
import { initRevenueFeatures } from './revenue.js';

const $ = id => document.getElementById(id);

async function getJson(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function setMessage(element, text, error = false) {
  element.replaceChildren();
  const span = document.createElement('span');
  span.className = error ? 'backend-error' : '';
  span.textContent = text;
  element.append(span);
}

function formatMoney(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 4 }).format(Number(value));
}

async function lookupStock(symbol) {
  const output = $('stockOutput');
  setMessage(output, 'Checking configured stock data providers…');
  try {
    const data = await getJson(`/api/stock?symbol=${encodeURIComponent(symbol)}`);
    output.replaceChildren();
    const price = document.createElement('strong');
    price.textContent = formatMoney(data.price, data.currency || 'USD');
    const title = document.createElement('div');
    title.textContent = `${data.symbol} · ${data.source}`;
    const change = document.createElement('div');
    change.className = data.change >= 0 ? 'backend-ok' : 'backend-error';
    change.textContent = data.changePercent !== null ? `${data.change >= 0 ? '+' : ''}${Number(data.change).toFixed(2)} (${Number(data.changePercent).toFixed(2)}%)` : 'Change data not supplied';
    const note = document.createElement('small');
    note.className = 'muted';
    note.textContent = `${data.quoteType || 'Provider quote'}${data.asOf ? ` · Provider timestamp: ${new Date(data.asOf).toLocaleString()}` : ''}${data.stale ? ' · Cached/stale quote' : ''}`;
    output.append(price, title, change, note);
  } catch (error) {
    setMessage(output, error.message, true);
  }
}

async function initializeAuth() {
  const authAction = $('authAction');
  const logoutAction = $('logoutAction');
  let session = { authenticated: false };
  try { session = await getJson('/api/auth/me', { credentials: 'same-origin' }); }
  catch { /* Public financial tools continue to work without an account. */ }
  if (session.authenticated) {
    authAction.hidden = true;
    logoutAction.hidden = false;
    logoutAction.textContent = `Sign out (${session.user.email})`;
  } else {
    authAction.hidden = false;
    logoutAction.hidden = true;
  }
  setPortfolioAuth(session.authenticated, session.csrfToken, session.accountDeletionEnabled);
  logoutAction.addEventListener('click', async () => {
    logoutAction.disabled = true;
    try {
      await getJson('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': session.csrfToken } });
      location.reload();
    } catch (error) {
      alert(error.message);
      logoutAction.disabled = false;
    }
  });
  return session;
}

async function initializeServiceStatus() {
  const indicator = $('backendIndicator');
  try {
    const health = await getJson('/api/health');
    const stocksReady = Object.values(health.providers.stocks || {}).some(Boolean);
    const secReady = Boolean(health.providers.sec);
    indicator.textContent = `API online · Crypto: CoinLore · FX: Frankfurter · News: GDELT · Stocks ${stocksReady ? 'configured' : 'needs optional key'} · SEC ${secReady ? 'ready' : 'needs contact email'}`;
    indicator.classList.add('backend-ok');
  } catch (error) {
    indicator.textContent = `Some backend services are unavailable: ${error.message}`;
    indicator.classList.add('backend-error');
  }
}

function initializeForms() {
  $('stockForm').addEventListener('submit', event => {
    event.preventDefault();
    const symbol = $('stockSymbol').value.trim().toUpperCase();
    if (symbol) lookupStock(symbol);
  });
  $('newsForm').addEventListener('submit', event => {
    event.preventDefault();
    loadNews($('newsQuery').value.trim());
  });
  $('filingsForm').addEventListener('submit', event => {
    event.preventDefault();
    loadFilings($('filingCik').value.trim());
  });
}

async function init() {
  initializeForms();
  initPortfolio();
  const [session] = await Promise.all([initializeAuth(), initializeServiceStatus()]);
  initRevenueFeatures(session);
  loadNews().catch(() => {});
}

document.addEventListener('DOMContentLoaded', init, { once: true });
