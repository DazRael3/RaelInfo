import { drawPortfolioChart } from './charts.js';
import { calculatePortfolioTotals } from './portfolio-calculations.js';
import { renderPortfolioAnalytics } from './portfolio-analytics.js';
import { setPriceAlertsAuth, initPriceAlerts, loadPriceAlerts } from './price-alerts.js';

const $ = (id) => document.getElementById(id);
let csrfToken = null;
let authenticated = false;
let accountDeletionPending = false;

async function api(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestError = new Error(body.error || `Request failed (${response.status})`);
    requestError.status = response.status;
    throw requestError;
  }
  return body;
}

export function setPortfolioAuth(isAuthenticated, token, accountDeletionEnabled = false, deletionPending = false) {
  const sessionAuthenticated = Boolean(isAuthenticated);
  accountDeletionPending = sessionAuthenticated && Boolean(deletionPending);
  authenticated = sessionAuthenticated && !accountDeletionPending;
  csrfToken = token || null;
  setPriceAlertsAuth(authenticated, token);
  initPriceAlerts();

  const form = $('portfolioForm');
  const state = $('accountState');
  const visual = $('portfolioVisual');
  const dataPanel = $('accountDataManagement');
  if (!form || !state) return;

  form.hidden = !authenticated;
  state.hidden = authenticated;
  if (dataPanel) dataPanel.hidden = !authenticated;

  if (accountDeletionPending) {
    state.replaceChildren();
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = accountDeletionEnabled
      ? 'Permanent account deletion is pending. Your saved account features are locked. '
      : 'Permanent account deletion is pending, but the deletion service is unavailable. Contact support@raelinfo.com for assistance. Do not email your password. ';

    const deletionLink = document.createElement('a');
    deletionLink.href = '/login.html#delete-account';
    deletionLink.textContent = accountDeletionEnabled
      ? 'Visit the sign-in page to retry deletion.'
      : 'Visit the sign-in page to check deletion status.';
    note.append(deletionLink);
    state.append(note);
    if ($('accountDataStatus')) $('accountDataStatus').textContent = '';

    if (visual) visual.hidden = true;
    $('portfolioOutput')?.replaceChildren();
    return;
  }

  if (!sessionAuthenticated) {
    if ($('accountDataStatus')) $('accountDataStatus').textContent = '';
    state.replaceChildren();
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = 'Sign in to save and manage your portfolio positions.';
    const link = document.createElement('a');
    link.className = 'text-btn';
    link.href = '/login.html';
    link.textContent = 'Sign in or create an account →';
    state.append(note, link);
    if (visual) visual.hidden = true;
    $('portfolioOutput')?.replaceChildren();
  } else {
    if (visual) visual.hidden = false;
    loadPortfolio();
    loadAccountDataSummary();
  }
}

async function loadAccountDataSummary() {
  if (!authenticated) return;
  const status = $('accountDataStatus');
  try {
    const data = await api('/api/account/data');
    const counts = data.counts || {};
    $('accountPortfolioCount').textContent = `${Number(counts.portfolio || 0)} saved`;
    $('accountAlertsCount').textContent = `${Number(counts.priceAlerts || 0)} saved`;
    $('accountWatchlistsCount').textContent = `${Number(counts.watchlists || 0)} saved`;
    if (status && !status.textContent) status.textContent = 'Choose one or more categories, then confirm before deleting.';
  } catch (error) {
    if (status) status.textContent = error.message;
  }
}

async function refreshAccountDataViews() {
  await Promise.all([
    loadPortfolio(),
    loadPriceAlerts(),
    loadAccountDataSummary()
  ]);
  window.dispatchEvent(new CustomEvent('raelinfo:data-changed'));
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
          await loadPriceAlerts();
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
      remove.addEventListener('click', () => removePosition(item.id, remove));

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

async function removePosition(id, button) {
  if (!button.dataset.confirming) {
    button.dataset.confirming = 'true';
    button.textContent = 'Confirm remove';
    button.classList.add('is-confirming');
    button.setAttribute('aria-label', 'Confirm removal of this portfolio position');
    return;
  }
  button.disabled = true;
  button.textContent = 'Removing…';
  try {
    await api(`/api/portfolio/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshAccountDataViews();
  } catch (error) {
    $('portfolioOutput').textContent = error.message;
    button.disabled = false;
    button.textContent = 'Remove';
    delete button.dataset.confirming;
    button.classList.remove('is-confirming');
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
  initPriceAlerts();

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
      await loadAccountDataSummary();
    } catch (error) {
      $('portfolioOutput').textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  $('accountDataForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!authenticated) return;
    const categories = [...$('accountDataForm').querySelectorAll('input[name="categories"]:checked')].map(input => input.value);
    const confirmation = $('confirmSelectedData');
    const status = $('accountDataStatus');
    if (!categories.length) {
      status.textContent = 'Select at least one category to delete.';
      return;
    }
    if (!confirmation.checked) {
      status.textContent = 'Check the confirmation box before deleting selected data.';
      confirmation.focus();
      return;
    }
    const submit = $('accountDataForm').querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Deleting selected data…';
    status.textContent = 'Deleting only the selected categories…';
    try {
      await api('/api/account/data', { method: 'DELETE', body: JSON.stringify({ categories }) });
      $('accountDataForm').reset();
      status.textContent = 'Selected saved data deleted. Your RaelInfo login and account profile are unchanged.';
      await refreshAccountDataViews();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Delete selected data';
    }
  });

  $('selectAllSavedData')?.addEventListener('click', () => {
    $('accountDataForm').querySelectorAll('input[name="categories"]').forEach(input => { input.checked = true; });
    $('confirmSelectedData').checked = false;
    $('accountDataStatus').textContent = 'All three saved-data categories are selected. Review the selection and check the confirmation box before deleting.';
  });


  window.addEventListener('raelinfo:data-changed', () => { loadAccountDataSummary().catch(() => {}); });

  window.addEventListener('resize', () => {
    if (authenticated) loadPortfolio().catch(() => {});
  });
}
