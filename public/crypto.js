export async function fetchCryptoSnapshot() {
  const response = await fetch('/api/crypto', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Crypto request failed (${response.status})`);
  return response.json();
}
