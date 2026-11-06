import { drawPortfolioChart } from './charts.js';

const $ = (id) => document.getElementById(id);
let csrfToken = null;
let authenticated = false;

async function api(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export function setPortfolioAuth(isAuthenticated, token, accountDeletionEnabled = false) {
  authenticated = Boolean(isAuthenticated);
  csrfToken = token || null;
  const form = $('portfolioForm');
  const state = $('accountState');
  const visual = $('portfolioVisual');
  const deleteAction = $('deleteAccountAction');
  if (!form || !state) return;
  form.hidden = !authenticated;
  state.hidden = authenticated;
  if (deleteAction) deleteAction.hidden = !authenticated || !accountDeletionEnabled;
  if (!authenticated) {
    state.replaceChildren();
    const note = document.createElement('span'); note.className = 'muted'; note.textContent = 'Sign in to save and manage your portfolio positions.';
    const link = document.createElement('a'); link.className = 'text-btn'; link.href = '/login.html'; link.textContent = 'Sign in or create an account →';
    state.append(note, link);
    visual.hidden = true;
    $('portfolioOutput').replaceChildren();
  } else {
    visual.hidden = false;
    loadPortfolio();
  }
}

export async function loadPortfolio() {
  if (!authenticated) return;
  const output = $('portfolioOutput');
  output.textContent = 'Loading saved positions…';
  try {
    const data = await api('/api/portfolio');
    output.replaceChildren();
    if (!data.items?.length) {
      const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No positions saved yet. Add your first position above.';
      output.append(empty);
    }
    for (const item of data.items) {
      const row = document.createElement('div'); row.className = 'backend-list-item portfolio-position';
      const left = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = item.symbol;
      const detail = document.createElement('small');
      const basis = Number(item.shares) * Number(item.averageCost);
      detail.textContent = `${formatQuantity(item.shares)} shares · ${money(item.averageCost, item.currency)} average cost · ${money(basis, item.currency)} cost basis`;
      left.append(title, detail);
      const actions = document.createElement('div');
      actions.style.display = 'flex'; actions.style.flexDirection = 'column'; actions.style.gap = '6px';
      const quote = document.createElement('button'); quote.type = 'button'; quote.className = 'portfolio-remove'; quote.textContent = 'Get quote';
      quote.addEventListener('click', () => lookupPositionQuote(item.symbol, item.shares, left));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'portfolio-remove'; remove.textContent = 'Remove'; remove.addEventListener('click', () => removePosition(item.id));
      actions.append(quote, remove);
      row.append(left, actions); output.append(row);
    }
    const totals = new Map();
    for (const item of data.items) {
      const currency = item.currency || 'USD';
      totals.set(currency, (totals.get(currency) || 0) + Number(item.shares) * Number(item.averageCost));
    }
    const total = document.createElement('p'); total.className = 'muted';
    const summary = [...totals.entries()].map(([currency, value]) => money(value, currency)).join(' · ');
    total.textContent = `Positions: ${data.items.length} · Cost basis by currency: ${summary || '—'}`;
    if (data.items.length) output.prepend(total);
    drawPortfolioChart($('portfolioChart'), data.items);
  } catch (error) {
    output.textContent = error.message;
  }
}

async function lookupPositionQuote(symbol, shares, container) {
  const existing = container.querySelector('[data-live-quote]');
  if (existing) existing.textContent = 'Loading provider quote…';
  else {
    const status = document.createElement('small'); status.dataset.liveQuote = 'true'; status.textContent = 'Loading provider quote…'; container.append(status);
  }
  try {
    const response = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Quote request failed (${response.status})`);
    const status = container.querySelector('[data-live-quote]');
    const value = Number(data.price) * Number(shares);
    status.textContent = `Indicative market value: ${money(value, data.currency || 'USD')} · ${data.source}${data.stale ? ' · cached' : ''}`;
  } catch (error) {
    const status = container.querySelector('[data-live-quote]');
    if (status) status.textContent = error.message;
  }
}

async function removePosition(id) {
  if (!confirm('Remove this portfolio position?')) return;
  try { await api(`/api/portfolio/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadPortfolio(); }
  catch (error) { $('portfolioOutput').textContent = error.message; }
}

function money(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
}
function formatQuantity(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(Number(value) || 0);
}

export function initPortfolio() {
  const form = $('portfolioForm');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!authenticated) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const item = {
        symbol: $('portfolioSymbol').value,
        shares: Number($('portfolioShares').value),
        averageCost: Number($('portfolioCost').value),
        currency: $('portfolioCurrency').value
      };
      await api('/api/portfolio/add', { method: 'POST', body: JSON.stringify(item) });
      form.reset();
      $('portfolioCurrency').value = 'USD';
      await loadPortfolio();
    } catch (error) {
      $('portfolioOutput').textContent = error.message;
    } finally { submit.disabled = false; }
  });
  $('deleteAccountAction')?.addEventListener('click', async () => {
    if (!confirm('Permanently delete your RaelInfo account and all saved portfolio positions? This cannot be undone.')) return;
    const password = prompt('Enter your password to confirm account deletion:');
    if (!password) return;
    try {
      await api('/api/auth/delete', { method: 'POST', body: JSON.stringify({ password }) });
      location.assign('/');
    } catch (error) {
      $('portfolioOutput').textContent = error.message;
    }
  });
  window.addEventListener('resize', () => {
    if (authenticated) loadPortfolio().catch(() => {});
  });
}
