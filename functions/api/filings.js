import { json, error, requireDatabase } from '../../functions-shared/http.js';
import { cachedJson, cacheHeaders } from '../../functions-shared/cache.js';
import { enforceRateLimitOrThrow } from '../../functions-shared/rate-limit.js';
import { fetchJson } from '../../functions-shared/providers.js';

export async function onRequestGet({ request, env }) {
  const cikInput = String(new URL(request.url).searchParams.get('cik') || '').trim();
  if (!/^\d{1,10}$/.test(cikInput)) return error('Enter an SEC CIK containing 1 to 10 digits.', 400);
  const userAgent = String(env.SEC_USER_AGENT || '');
  if (!userAgent.includes('@') || userAgent.includes('example.com') || userAgent.length > 200) {
    return error('SEC filings are disabled until SEC_USER_AGENT contains your application name and a monitored contact email.', 503);
  }
  try {
    requireDatabase(env);
    const cik = cikInput.padStart(10, '0');
    const result = await cachedJson(env, `sec:${cik}`, 900, async () => {
      const data = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, {
        headers: { 'User-Agent': userAgent }
      });
      const recent = data?.filings?.recent || {};
      const forms = recent.form || [];
      const dates = recent.filingDate || [];
      const accessions = recent.accessionNumber || [];
      const documents = recent.primaryDocument || [];
      const descriptions = recent.primaryDocDescription || [];
      const filings = forms.slice(0, 30).map((form, index) => {
        const accession = accessions[index] || '';
        const document = documents[index] || '';
        const cikPath = String(Number(cik));
        const url = accession && document
          ? `https://www.sec.gov/Archives/edgar/data/${cikPath}/${accession.replaceAll('-', '')}/${encodeURIComponent(document)}`
          : '';
        return { form, filingDate: dates[index] || '', accessionNumber: accession, description: descriptions[index] || '', url };
      });
      return { cik, companyName: data.name || '', tickers: data.tickers || [], exchanges: data.exchanges || [], filings };
    }, 86_400, () => enforceRateLimitOrThrow(env, request, 'market-sec-filings', 12, 60));
    return json({ ...result.data, stale: result.stale, retrievedAt: new Date(result.savedAt * 1000).toISOString() }, 200, cacheHeaders(result));
  } catch (err) {
    if (err?.status === 429) {
      return error('Market data is being refreshed too frequently. Please retry shortly.', 429, {
        'Retry-After': String(err.retryAfter || 60)
      });
    }
    console.error('SEC provider error:', err.message);
    return error('SEC filing data is temporarily unavailable. Check the CIK and try again later.', 502);
  }
}
