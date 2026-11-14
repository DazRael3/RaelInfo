import { drawPortfolioChart } from './charts.js';
import { calculatePortfolioTotals } from './portfolio-calculations.js';
import { renderPortfolioAnalytics } from './portfolio-analytics.js';

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
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = 'Sign in to save and manage your portfolio positions.';
    const link = document.createElement('a');
    link.className = 'text-btn';
    link.href = '/login.html';
    link.textContent = 'Sign in or create an account →';
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
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No positions saved yet. Add your first position above.';
      output.append(empty);
    }

    const { costTotals, marketTotals, gainTotals, pricedCounts } =
      calculatePortfolioTotals(data.items || []);

    for (const item of data.items || []) {
      const currency = item.currency || 'USD';
      const shares = Number(item.shares);
      const averageCost = Number(item.averageCost);
      const basis = shares * averageCost;

      const row = document.createElement('div');
      row.className = 'backend-list-item portfolio-position';

      const left = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.symbol;

      const detail = document.createElement('small');
      detail.textContent = `${formatQuantity(shares)} shares · ${money(averageCost, currency)} average cost · ${money(basis, currency)} cost basis`;
      left.append(title, detail);

      const priceDetails = document.createElement('small');
      const hasPrice = item.currentPrice !== null && item.currentPrice !== undefined &&
        Number.isFinite(Number(item.currentPrice)) && Number(item.currentPrice) > 0;

      if (hasPrice) {
        const currentPrice = Number(item.currentPrice);
        const marketValue = shares * currentPrice;
        const gain = marketValue - basis;

        priceDetails.textContent = `User-entered price: ${money(currentPrice, currency)} · Market value: ${money(marketValue, currency)} · Unrealized ${gain >= 0 ? 'gain' : 'loss'}: ${money(gain, currency)}`;
        if (item.priceUpdatedAt) {
          const updated = new Date(item.priceUpdatedAt);
          const time = Number.isNaN(updated.getTime()) ? item.priceUpdatedAt : updated.toLocaleString();
          priceDetails.textContent += ` · Price saved: ${time}`;
        }
      } else {
        priceDetails.textContent = 'No manual price entered. Market value is not available.';
      }
      left.append(priceDetails);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.flexDirection = 'column';
      actions.style.gap = '6px';

      const priceInput = document.createElement('input');
      priceInput.type = 'number';
      priceInput.min = '0.00000001';
      priceInput.max = '1000000000';
      priceInput.step = 'any';
      priceInput.inputMode = 'decimal';
      priceInput.setAttribute('aria-label', `${item.symbol} current price in ${currency}`);
      priceInput.placeholder = `Current price (${currency})`;
      if (hasPrice) priceInput.value = String(item.currentPrice);

      const savePrice = document.createElement('button');
      savePrice.type = 'button';
      savePrice.className = 'portfolio-remove';
      savePrice.textContent = 'Save price';
      savePrice.addEventListener('click', async () => {
        if (!priceInput.value.trim()) {
          priceInput.setCustomValidity('Enter a current price.');
          priceInput.reportValidity();
          return;
        }
        const value = Number(priceInput.value);
        if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
          priceInput.setCustomValidity('Enter a price greater than zero and no more than 1,000,000,000.');
          priceInput.reportValidity();
          return;
        }
        priceInput.setCustomValidity('');
        savePrice.disabled = true;
        try {
          await api(`/api/portfolio/${encodeURIComponent(item.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ currentPrice: value })
          });
          await loadPortfolio();
        } catch (error) {
          priceDetails.textContent = error.message;
        } finally {
          savePrice.disabled = false;
        }
      });

      const clearPrice = document.createElement('button');
      clearPrice.type = 'button';
      clearPrice.className = 'portfolio-remove';
      clearPrice.textContent = 'Clear price';
      clearPrice.disabled = !hasPrice;
      clearPrice.addEventListener('click', async () => {
        clearPrice.disabled = true;
        try {
          await api(`/api/portfolio/${encodeURIComponent(item.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ currentPrice: null })
          });
          await loadPortfolio();
        } catch (error) {
          priceDetails.textContent = error.message;
          clearPrice.disabled = false;
        }
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'portfolio-remove';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => removePosition(item.id));

      actions.append(priceInput, savePrice, clearPrice, remove);
      row.append(left, actions);
      output.append(row);
    }

    if (data.items?.length) {
      const summary = document.createElement('div');
      summary.className = 'muted';

      const costText = [...costTotals.entries()]
        .map(([currency, value]) => money(value, currency)).join(' · ') || '—';
      const marketText = [...marketTotals.entries()]
        .map(([currency, value]) => `${money(value, currency)} (${pricedCounts.get(currency) || 0} priced)`).join(' · ') || 'No prices entered';
      const gainText = [...gainTotals.entries()]
        .map(([currency, value]) => money(value, currency)).join(' · ') || '—';

      const positions = document.createElement('p');
      positions.textContent = `Positions: ${data.items.length} · Cost basis by currency: ${costText}`;
      const market = document.createElement('p');
      market.textContent = `Market value by currency (priced positions only): ${marketText}`;
      const gain = document.createElement('p');
      gain.textContent = `Unrealized gain/loss on priced positions by currency: ${gainText}`;
      summary.append(positions, market, gain);
      output.prepend(summary);
    }

    drawPortfolioChart($('portfolioChart'), data.items);
    renderPortfolioAnalytics($('portfolioAnalytics'), data.items || []);
  } catch (error) {
    output.textContent = error.message;
  }
}

async function removePosition(id) {
  if (!confirm('Remove this portfolio position?')) return;
  try {
    await api(`/api/portfolio/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadPortfolio();
  } catch (error) {
    $('portfolioOutput').textContent = error.message;
  }
}

function money(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
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
    } finally {
      submit.disabled = false;
    }
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
