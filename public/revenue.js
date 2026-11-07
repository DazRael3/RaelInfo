let revenueCsrf = null;
let proJoined = false;

export function trackSiteEvent(event, category = 'general', market = 'US') {
  const payload = { event, category, market };
  try {
    fetch('/api/analytics/event', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  } catch { /* Measurement must never interrupt a calculator. */ }
}

async function api(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && revenueCsrf) headers['X-CSRF-Token'] = revenueCsrf;
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function setStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('backend-error', isError);
  element.classList.toggle('backend-ok', !isError);
}

export function initRevenueFeatures(session = { authenticated: false }) {
  const card = document.getElementById('proInterestCard');
  if (!card) return;
  revenueCsrf = session.csrfToken || null;
  const action = document.getElementById('proInterestAction');
  const status = document.getElementById('proInterestStatus');
  if (!session.authenticated) {
    const link = document.createElement('a');
    link.href = '/login.html';
    link.className = 'btn primary';
    link.textContent = 'Sign in to register interest';
    action.replaceChildren(link);
    setStatus(status, 'Optional. No payment or subscription is being offered today.');
    return;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn primary';
  button.disabled = true;
  button.textContent = 'Checking status…';
  action.replaceChildren(button);

  const render = joined => {
    proJoined = Boolean(joined);
    button.disabled = false;
    button.textContent = proJoined ? 'Withdraw interest' : 'Register interest';
    button.classList.toggle('subtle', proJoined);
    setStatus(status, proJoined
      ? 'You are registered as interested. This is not a paid subscription; you can withdraw any time.'
      : 'Tell us you may be interested in future planning features. This does not create a subscription or authorize a charge.');
  };

  api('/api/pro/interest').then(data => render(data.joined)).catch(error => {
    button.disabled = true;
    button.textContent = 'Interest status unavailable';
    setStatus(status, error.message, true);
  });

  button.addEventListener('click', async () => {
    button.disabled = true;
    const joining = !proJoined;
    try {
      const data = await api('/api/pro/interest', {
        method: joining ? 'POST' : 'DELETE',
        body: JSON.stringify({})
      });
      render(data.joined);
      if (joining) { let market = 'US'; try { const saved = localStorage.getItem('raelinfo_market_v1'); if (saved === 'US' || saved === 'CA') market = saved; } catch {} trackSiteEvent('pro_interest_join', 'general', market); }
    } catch (error) {
      setStatus(status, error.message, true);
      button.disabled = false;
    }
  });
}
