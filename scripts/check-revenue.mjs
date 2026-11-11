import assert from 'node:assert/strict';
import { getApprovedPartnerOffers, publicOffer } from '../functions-shared/partners.js';
import { isRevenueAdmin } from '../functions-shared/admin.js';
import { onRequestGet as getPartnerOffers } from '../functions/api/partners.js';
import { onRequestGet as getInquiryStatus, onRequestPost as submitInquiry } from '../functions/api/partner-inquiry.js';
import { onRequestGet as getRevenueReport } from '../functions/api/admin/revenue.js';
import { onRequestPost as saveConversion } from '../functions/api/admin/revenue/conversions.js';
import { onRequestPatch as updateInquiry } from '../functions/api/admin/revenue/inquiries/[id].js';

assert.deepEqual(getApprovedPartnerOffers({}), [], 'No offers must be active by default');
assert.deepEqual(getApprovedPartnerOffers({ PARTNER_OFFERS_JSON: '[]' }), [], 'Explicit empty offer list must remain empty');

const approved = {
  id: 'wise-ca', partnerName: 'Wise', title: 'Compare transfer options',
  description: 'Review fees, exchange rates and terms.',
  destinationUrl: 'https://example.org/approved-tracking-link',
  categories: ['crossborder'], markets: ['CA'], currencies: ['CAD'],
  active: true, approved: true, approvedAt: '2026-11-07'
};
const offers = getApprovedPartnerOffers({ PARTNER_OFFERS_JSON: JSON.stringify([approved]) });
assert.equal(offers.length, 1, 'Approved HTTPS offer should be accepted');
assert.equal(offers[0].id, 'wise-ca');
assert.equal('destinationUrl' in publicOffer(offers[0]), false, 'Public API must not expose destination URL');
assert.equal(getApprovedPartnerOffers({ PARTNER_OFFERS_JSON: JSON.stringify([{ ...approved, approved: false }]) }).length, 0, 'Unapproved offer must remain hidden');
assert.equal(getApprovedPartnerOffers({ PARTNER_OFFERS_JSON: JSON.stringify([{ ...approved, active: false }]) }).length, 0, 'Inactive offer must remain hidden');
assert.equal(getApprovedPartnerOffers({ PARTNER_OFFERS_JSON: JSON.stringify([{ ...approved, destinationUrl: 'http://example.org' }]) }).length, 0, 'Non-HTTPS destinations must be rejected');
assert.equal(getApprovedPartnerOffers({ PARTNER_OFFERS_JSON: JSON.stringify([approved, approved]) }).length, 1, 'Duplicate offer IDs must be deduplicated');

const adminToken = 'test-only-random-admin-token-with-at-least-32-characters';
assert.equal(isRevenueAdmin(new Request('https://example.test', { headers: { Authorization: `Bearer ${adminToken}` } }), { RAELINFO_ADMIN_TOKEN: adminToken }), true);
assert.equal(isRevenueAdmin(new Request('https://example.test', { headers: { Authorization: 'Bearer wrong-token' } }), { RAELINFO_ADMIN_TOKEN: adminToken }), false);
assert.equal(isRevenueAdmin(new Request('https://example.test'), {}), false);

const offersResponse = await getPartnerOffers({ request: new Request('https://example.test/api/partners?market=US'), env: {} });
assert.equal(offersResponse.status, 200);
assert.deepEqual((await offersResponse.json()).offers, []);

const inquiryStatus = await getInquiryStatus({ env: {} });
assert.equal((await inquiryStatus.json()).enabled, false, 'Business inquiry form must be disabled by default');
const inquiryPost = await submitInquiry({ request: new Request('https://example.test/api/partner-inquiry', { method: 'POST' }), env: {} });
assert.equal(inquiryPost.status, 503, 'Inquiry submission must fail closed while disabled');

const adminResponse = await getRevenueReport({ request: new Request('https://example.test/api/admin/revenue'), env: {} });
assert.equal(adminResponse.status, 401, 'Owner revenue API must require its bearer token');

const adminEnv = { RAELINFO_ADMIN_TOKEN: adminToken };
const conversionUrl = 'https://example.test/api/admin/revenue/conversions';
const validConversion = {
  offerId: 'wise-ca',
  partnerName: 'Wise',
  externalRef: 'network-ref-001',
  market: 'CA',
  currency: 'CAD',
  status: 'pending',
  commissionAmount: 10,
  conversionDate: '2026-11-10'
};

function conversionRequest(body, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (options.authorization !== false) headers.Authorization = `Bearer ${adminToken}`;
  if (options.origin !== false) headers.Origin = options.origin || 'https://example.test';
  return new Request(conversionUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

async function conversionStatus(body, options) {
  const response = await saveConversion({
    request: conversionRequest(body, options),
    env: adminEnv
  });
  return response.status;
}

assert.equal(await conversionStatus(validConversion, { authorization: false }), 401,
  'Conversion writes must require the admin token');
assert.equal(await conversionStatus(validConversion, { origin: false }), 403,
  'Conversion writes must reject requests without an Origin header');
assert.equal(await conversionStatus(validConversion, { origin: 'https://attacker.example' }), 403,
  'Conversion writes must reject cross-origin requests');
assert.equal(await conversionStatus({ ...validConversion, conversionDate: '2026-02-30' }), 400,
  'Conversion writes must reject impossible calendar dates');
assert.equal(await conversionStatus({ ...validConversion, conversionDate: '2026-02-29' }), 400,
  'Conversion writes must reject non-leap-year February 29');
assert.equal(await conversionStatus({ ...validConversion, conversionDate: '2024-02-29' }), 503,
  'Valid leap-day dates must pass date validation and reach the database');
assert.equal(await conversionStatus({ ...validConversion, commissionAmount: '' }), 400,
  'Conversion writes must reject empty commission amounts');
assert.equal(await conversionStatus({ ...validConversion, commissionAmount: '   ' }), 400,
  'Conversion writes must reject whitespace-only commission amounts');

const inquiryCrossOrigin = await updateInquiry({
  request: new Request('https://example.test/api/admin/revenue/inquiries/test-id', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Origin: 'https://attacker.example',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'closed' })
  }),
  env: adminEnv,
  params: { id: 'test-id' }
});
assert.equal(inquiryCrossOrigin.status, 403,
  'Inquiry updates must reject cross-origin requests');

console.log('Revenue safe-default, offer validation, admin origin protection, date validation, and amount validation checks passed.');
