const $ = (id) => document.getElementById(id);

export async function loadNews(query = 'stock market OR economy') {
  const output = $('newsOutput');
  if (!output) return;
  output.replaceChildren(message('Loading articles…'));
  try {
    const response = await fetch(`/api/news?q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `News request failed (${response.status})`);
    output.replaceChildren();
    if (!data.articles?.length) { output.append(message('No matching articles were returned. Try another topic.')); return; }
    for (const article of data.articles) {
      const item = document.createElement('article');
      item.className = 'backend-list-item';
      const link = document.createElement('a');
      link.href = article.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = article.title;
      const meta = document.createElement('small');
      const date = article.publishedAt ? formatDate(article.publishedAt) : 'Publication date unavailable';
      meta.textContent = `${article.source || 'External publisher'} · ${date}${data.stale ? ' · cached result' : ''}`;
      item.append(link, meta);
      output.append(item);
    }
  } catch (error) {
    output.replaceChildren(message(error.message, true));
  }
}

function message(text, isError = false) {
  const p = document.createElement('p');
  p.className = isError ? 'muted backend-error' : 'muted';
  p.textContent = text;
  return p;
}

function formatDate(value) {
  const normalized = /^\d{14}$/.test(String(value))
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
