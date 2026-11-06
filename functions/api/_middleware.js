export async function onRequest(context) {
  try {
    const response = await context.next();
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (err) {
    console.error('RaelInfo API unhandled error:', err?.message || err);
    return new Response(JSON.stringify({ error: 'An unexpected server error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
  }
}
