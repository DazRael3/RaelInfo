import { json, error, readJson, isSameOrigin, requireDatabase } from '../../functions-shared/http.js';
import { enforceRateLimit } from '../../functions-shared/rate-limit.js';

const TYPES = new Set(['affiliate', 'sponsorship', 'calculator_licensing', 'other']);

export async function onRequestGet({ env }) {
  const enabled = String(env.PARTNER_INQUIRIES_ENABLED || '').toLowerCase() === 'true';
  return json({ enabled, message: enabled ? 'Partnership inquiries are open.' : 'Partnership inquiries are temporarily closed while RaelInfo completes its operator contact and privacy details.' });
}

export async function onRequestPost({ request, env }) {
  if (String(env.PARTNER_INQUIRIES_ENABLED || '').toLowerCase() !== 'true') return error('Partnership inquiries are temporarily closed. Please check back later.', 503);
  if (!isSameOrigin(request)) return error('Request origin not allowed.', 403);
  try {
    const rate = await enforceRateLimit(env, request, 'partner-inquiry', 4, 3600);
    if (!rate.allowed) return error('Inquiry limit reached. Please try again later.', 429, { 'Retry-After': String(rate.retryAfter) });
    const body = await readJson(request, 8192);
    // Honeypot field: humans should leave this hidden field empty.
    if (String(body.nickname || '').trim()) return json({ ok: true, message: 'Inquiry received.' }, 202);
    const name = String(body.name || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const organization = String(body.organization || '').trim().slice(0, 120);
    const type = String(body.inquiryType || '').trim();
    const website = String(body.website || '').trim().slice(0, 200);
    const message = String(body.message || '').trim().slice(0, 3000);
    if (name.length < 2) return error('Enter your name.', 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('Enter a valid business email address.', 400);
    if (!organization || !TYPES.has(type)) return error('Enter your organization and select an inquiry type.', 400);
    if (website && !/^https:\/\//i.test(website)) return error('Website must start with https://.', 400);
    if (message.length < 20) return error('Please provide at least 20 characters of detail.', 400);
    if (body.consent !== true) return error('Please confirm the contact and privacy consent.', 400);
    const db = requireDatabase(env);
    await db.prepare(`INSERT INTO business_inquiries
      (id, contact_name, contact_email, organization, inquiry_type, website, message, consent, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'new', ?)`)
      .bind(crypto.randomUUID(), name, email, organization, type, website, message, new Date().toISOString()).run();
    return json({ ok: true, message: 'Your partnership inquiry has been received.' }, 201);
  } catch (err) {
    console.error('Partnership inquiry error:', err.message);
    return err.message.startsWith('Request body') ? error(err.message, 400) : error('Your inquiry could not be saved. Please try again later.', 503);
  }
}
