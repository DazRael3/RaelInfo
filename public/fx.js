export async function fetchFxRate(from = 'USD', to = 'CAD') {
  const url = `/api/fx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `FX request failed (${response.status})`);
  return response.json();
}
