export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs || 12_000),
    headers: { Accept: 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('json')) throw new Error('Provider returned a non-JSON response');
  return response.json();
}

export function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeStock(symbol, price, source, extras = {}) {
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
    quoteType: extras.quoteType || 'Provider quote; check source timestamp and display terms.'
  };
}

export async function getStockQuote(symbol, env) {
  const order = String(env.STOCK_PROVIDER_ORDER || 'alpha,fmp,eod').split(',').map(x => x.trim().toLowerCase());
  const providers = {
    async alpha() {
      if (!env.ALPHA_VANTAGE_KEY) throw new Error('Alpha Vantage key not configured');
      const url = new URL('https://www.alphavantage.co/query');
      url.search = new URLSearchParams({ function: 'GLOBAL_QUOTE', symbol, apikey: env.ALPHA_VANTAGE_KEY });
      const data = await fetchJson(url);
      if (data.Note || data.Information || data['Error Message']) throw new Error('Alpha Vantage did not return a quote');
      const q = data['Global Quote'] || {};
      return normalizeStock(symbol, q['05. price'], 'Alpha Vantage', {
        change: q['09. change'], changePercent: String(q['10. change percent'] || '').replace('%', ''),
        volume: q['06. volume'], asOf: q['07. latest trading day'],
        quoteType: 'Alpha Vantage Global Quote; the default free endpoint may be delayed or end-of-day.'
      });
    },
    async fmp() {
      if (!env.FMP_KEY) throw new Error('FMP key not configured');
      const url = new URL('https://financialmodelingprep.com/stable/quote');
      url.search = new URLSearchParams({ symbol, apikey: env.FMP_KEY });
      const data = await fetchJson(url);
      const q = Array.isArray(data) ? data[0] : null;
      return normalizeStock(symbol, q?.price, 'Financial Modeling Prep', {
        currency: q?.currency || 'USD', change: q?.change, changePercent: q?.changePercentage,
        volume: q?.volume, asOf: q?.timestamp ? new Date(Number(q.timestamp) * 1000).toISOString() : null,
        quoteType: 'FMP quote; access and public display rights depend on your plan.'
      });
    },
    async eod() {
      if (!env.EODHD_KEY) throw new Error('EODHD key not configured');
      const eodSymbol = symbol.includes('.') ? symbol : `${symbol}.US`;
      const url = new URL(`https://eodhd.com/api/real-time/${encodeURIComponent(eodSymbol)}`);
      url.search = new URLSearchParams({ api_token: env.EODHD_KEY, fmt: 'json' });
      const q = await fetchJson(url);
      return normalizeStock(symbol, q.close, 'EOD Historical Data', {
        currency: q.currency || 'USD', change: q.change, changePercent: q.change_p,
        volume: q.volume, asOf: q.timestamp ? new Date(Number(q.timestamp) * 1000).toISOString() : null,
        quoteType: 'EODHD quote; free-plan access and public display rights may be restricted.'
      });
    }
  };
  const configured = order.filter(name => providers[name] && ({ alpha: env.ALPHA_VANTAGE_KEY, fmp: env.FMP_KEY, eod: env.EODHD_KEY })[name]);
  if (!configured.length) throw new Error('No stock provider is configured with an API key.');
  const failures = [];
  for (const name of configured) {
    try { return await providers[name](); }
    catch (err) { failures.push(`${name}: ${err.message}`); }
  }
  throw new Error(failures.join('; ') || 'All stock providers failed.');
}
