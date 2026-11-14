const $ = id => document.getElementById(id);

let authenticated = false;
let csrfToken = null;
let initializedForm = null;

async function api(url, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {})
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.method && options.method !== 'GET' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }

  return body;
}

export function setPriceAlertsAuth(isAuthenticated, token) {
  authenticated = Boolean(isAuthenticated);
  csrfToken = token || null;

  const workspace = $('priceAlertsWorkspace');

  if (!workspace) return;

  workspace.hidden = !authenticated;

  if (authenticated) {
    loadPriceAlerts();
  } else {
    $('priceAlertsOutput')?.replaceChildren();
    $('priceAlertsStatus').textContent = '';
  }
}

export async function loadPriceAlerts() {
  if (!authenticated) return;

  const output = $('priceAlertsOutput');
  const status = $('priceAlertsStatus');

  if (!output || !status) return;

  output.textContent = 'Loading price alerts…';

  try {
    const data = await api('/api/price-alerts');
    output.replaceChildren();

    const alerts = data.alerts || [];

    if (!alerts.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No price alerts yet. Create one above.';
      output.append(empty);
    }

    for (const alert of alerts) {
      const row = document.createElement('div');
      row.className = 'backend-list-item price-alert-item';

      const details = document.createElement('div');

      const heading = document.createElement('strong');
      heading.textContent =
        `${alert.symbol} ${alert.direction === 'above' ? '≥' : '≤'} ${money(alert.targetPrice, alert.currency)}`;

      const description = document.createElement('small');
      description.textContent =
        `${alert.currency} · ${alert.status === 'active' ? 'Active' : 'Triggered'}`;

      details.append(heading, description);

      if (alert.status === 'triggered') {
        const triggered = document.createElement('small');
        triggered.textContent =
          `Triggered at ${money(alert.triggeredPrice, alert.currency)} · ${formatDate(alert.triggeredAt)}`;
        details.append(triggered);
      } else {
        const note = document.createElement('small');
        note.textContent = 'Waiting for a matching saved manual portfolio price.';
        details.append(note);
      }

      const actions = document.createElement('div');
      actions.className = 'price-alert-actions';

      if (alert.status === 'triggered') {
        const reactivate = document.createElement('button');
        reactivate.type = 'button';
        reactivate.className = 'portfolio-remove';
        reactivate.textContent = 'Reactivate';

        reactivate.addEventListener('click', async () => {
          reactivate.disabled = true;

          try {
            await api(`/api/price-alerts/${encodeURIComponent(alert.id)}`, {
              method: 'PATCH'
            });
            await loadPriceAlerts();
          } catch (error) {
            status.textContent = error.message;
            reactivate.disabled = false;
          }
        });

        actions.append(reactivate);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'portfolio-remove';
      remove.textContent = 'Delete';

      remove.addEventListener('click', async () => {
        remove.disabled = true;

        try {
          await api(`/api/price-alerts/${encodeURIComponent(alert.id)}`, {
            method: 'DELETE'
          });
          await loadPriceAlerts();
        } catch (error) {
          status.textContent = error.message;
          remove.disabled = false;
        }
      });

      actions.append(remove);
      row.append(details, actions);
      output.append(row);
    }

    status.textContent = `${alerts.filter(item => item.status === 'active').length} active · ${alerts.filter(item => item.status === 'triggered').length} triggered`;
  } catch (error) {
    output.textContent = error.message;
  }
}

function money(value, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 4
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return 'time unavailable';

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();
}

export function initPriceAlerts() {
  const form = $('priceAlertForm');

  if (!form || initializedForm === form) return;

  initializedForm = form;

  form.addEventListener('submit', async event => {
    event.preventDefault();

    if (!authenticated) return;

    const submit = form.querySelector('[type="submit"]');
    const status = $('priceAlertsStatus');

    submit.disabled = true;
    status.textContent = 'Creating alert…';

    try {
      const alert = {
        symbol: $('priceAlertSymbol').value,
        currency: $('priceAlertCurrency').value,
        direction: $('priceAlertDirection').value,
        targetPrice: Number($('priceAlertTarget').value)
      };

      await api('/api/price-alerts', {
        method: 'POST',
        body: JSON.stringify(alert)
      });

      form.reset();
      $('priceAlertCurrency').value = 'USD';
      $('priceAlertDirection').value = 'above';

      status.textContent = 'Price alert created.';
      await loadPriceAlerts();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}
