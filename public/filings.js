const $ = (id) => document.getElementById(id);

export async function loadFilings(cik) {
  const output = $('filingsOutput');
  if (!output) return;
  output.replaceChildren(text('Loading SEC submissions…'));
  try {
    const response = await fetch(`/api/filings?cik=${encodeURIComponent(cik)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `SEC request failed (${response.status})`);
    output.replaceChildren();
    const heading = document.createElement('p');
    heading.className = 'muted';
    heading.textContent = `${data.companyName || 'SEC registrant'}${data.tickers?.length ? ` · ${data.tickers.join(', ')}` : ''} · CIK ${data.cik}`;
    output.append(heading);
    if (!data.filings?.length) { output.append(text('No recent filing records were found.')); return; }
    for (const filing of data.filings) {
      const item = document.createElement('article');
      item.className = 'backend-list-item';
      const title = document.createElement('strong');
      title.textContent = `${filing.form} · ${filing.filingDate || 'Date unavailable'}`;
      const meta = document.createElement('small');
      meta.textContent = filing.description || filing.accessionNumber || '';
      item.append(title, meta);
      if (filing.url) {
        const link = document.createElement('a');
        link.href = filing.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = 'Open filing document →'; link.style.fontSize = '.78rem';
        item.append(link);
      }
      output.append(item);
    }
  } catch (error) {
    output.replaceChildren(text(error.message, true));
  }
}

function text(value, isError = false) {
  const p = document.createElement('p');
  p.className = isError ? 'muted backend-error' : 'muted';
  p.textContent = value;
  return p;
}
