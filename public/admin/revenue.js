let adminToken = '';
const $ = id => document.getElementById(id);
const text = value => String(value ?? '');

function cell(row, value) {
  const td = document.createElement('td');
  td.textContent = text(value);
  row.append(td);
  return td;
}
function money(value, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
}
function setStatus(message, isError = false, element = $('ownerStatus')) {
  element.textContent = message;
  element.className = isError ? 'owner-note owner-error' : 'owner-note owner-success';
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: { Accept: 'application/json', Authorization: `Bearer ${adminToken}`, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function render(data) {
  $('report').hidden = false;
  $('totalClicks').textContent = data.clicks.reduce((sum, item) => sum + Number(item.clicks || 0), 0).toLocaleString();
  $('totalConversions').textContent = data.conversions.filter(item => item.status === 'approved').reduce((sum, item) => sum + Number(item.conversions || 0), 0).toLocaleString();
  $('proCount').textContent = Number(data.proInterest || 0).toLocaleString();
  $('inquiryCount').textContent = Number(data.inquiryCount ?? data.inquiries.length).toLocaleString();

  const totals = new Map();
  for (const item of data.conversions) {
    if (item.status !== 'approved') continue;
    totals.set(item.currency, (totals.get(item.currency) || 0) + Number(item.commissionAmount || 0));
  }
  const summary = $('commissionSummary'); summary.replaceChildren();
  for (const currency of ['USD', 'CAD']) {
    const box = document.createElement('div'); box.className = 'owner-stat';
    const label = document.createElement('small'); label.textContent = `Approved commission (${currency})`;
    const value = document.createElement('strong'); value.textContent = money(totals.get(currency) || 0, currency);
    box.append(label, value); summary.append(box);
  }

  const clicks = $('clickRows'); clicks.replaceChildren();
  for (const item of data.clicks) {
    const row = document.createElement('tr');
    cell(row, item.partnerName); cell(row, item.market); cell(row, item.category); cell(row, item.placement);
    cell(row, Number(item.clicks).toLocaleString()); cell(row, item.lastClick ? new Date(item.lastClick).toLocaleString() : '—');
    clicks.append(row);
  }
  if (!data.clicks.length) { const row = document.createElement('tr'); cell(row, 'No approved partner offers have recorded clicks yet.').colSpan = 6; clicks.append(row); }

  const conversions = $('conversionRows'); conversions.replaceChildren();
  for (const item of data.recentConversions) {
    const row = document.createElement('tr');
    cell(row, item.partnerName); cell(row, item.externalRef); cell(row, item.market);
    cell(row, money(item.commissionAmount, item.currency)); cell(row, item.status); cell(row, item.conversionDate);
    conversions.append(row);
  }
  if (!data.recentConversions.length) { const row = document.createElement('tr'); cell(row, 'No conversion records yet.').colSpan = 6; conversions.append(row); }

  const events = $('eventRows'); events.replaceChildren();
  for (const item of data.events) {
    const row = document.createElement('tr'); cell(row, item.eventName); cell(row, item.category); cell(row, item.market); cell(row, Number(item.events).toLocaleString()); events.append(row);
  }
  if (!data.events.length) { const row = document.createElement('tr'); cell(row, 'No first-party events recorded yet.').colSpan = 4; events.append(row); }

  const inquiries = $('inquiryRows'); inquiries.replaceChildren();
  for (const item of data.inquiries) {
    const row = document.createElement('tr');
    cell(row, new Date(item.createdAt).toLocaleDateString());
    const contact = cell(row, '');
    const link = document.createElement('a');
    link.href = `mailto:${encodeURIComponent(item.contactEmail)}?subject=${encodeURIComponent('RaelInfo partnership inquiry')}`;
    link.textContent = `${item.contactName} · ${item.contactEmail}`; contact.append(link);
    cell(row, item.organization);
    cell(row, `${item.inquiryType.replaceAll('_', ' ')} — ${item.message}`);
    cell(row, item.status);
    const actions = cell(row, '');
    for (const next of ['reviewing', 'contacted', 'closed']) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = next;
      button.addEventListener('click', () => updateInquiry(item.id, next)); actions.append(button, ' ');
    }
    inquiries.append(row);
  }
  if (!data.inquiries.length) { const row = document.createElement('tr'); cell(row, 'No business inquiries yet.').colSpan = 6; inquiries.append(row); }
}

async function loadReport() {
  setStatus('Loading private report…');
  try {
    const data = await api('/api/admin/revenue');
    render(data);
    setStatus(`Report loaded ${new Date(data.generatedAt).toLocaleString()}.`);
  } catch (error) {
    $('report').hidden = true;
    setStatus(error.message, true);
  }
}

async function updateInquiry(id, nextStatus) {
  try {
    await api(`/api/admin/revenue/inquiries/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus })
    });
    await loadReport();
  } catch (error) { setStatus(error.message, true); }
}

$('connectForm').addEventListener('submit', async event => {
  event.preventDefault();
  adminToken = $('adminToken').value.trim();
  if (adminToken.length < 32) { setStatus('The owner token must be at least 32 characters.', true); return; }
  await loadReport();
});
$('clearToken').addEventListener('click', () => {
  adminToken = ''; $('adminToken').value = ''; $('report').hidden = true; setStatus('Owner token cleared from this page.');
});
$('conversionForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  body.commissionAmount = Number(body.commissionAmount);
  const output = $('conversionStatus'); output.textContent = 'Saving…';
  try {
    await api('/api/admin/revenue/conversions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    form.reset(); form.elements.conversionDate.value = new Date().toISOString().slice(0, 10);
    output.textContent = 'Saved.'; await loadReport();
  } catch (error) { output.textContent = error.message; }
});
$('conversionForm').elements.conversionDate.value = new Date().toISOString().slice(0, 10);
