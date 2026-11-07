import assert from 'node:assert/strict';
import { getApprovedPartnerOffers, publicOffer } from '../functions-shared/partners.js';
import { isRevenueAdmin } from '../functions-shared/admin.js';
import { onRequestGet as getPartnerOffers } from '../functions/api/partners.js';
import { onRequestGet as getInquiryStatus, onRequestPost as submitInquiry } from '../functions/api/partner-inquiry.js';
import { onRequestGet as getRevenueReport } from '../functions/api/admin/revenue.js';

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

console.log('Revenue safe-default, offer validation, and owner-access checks passed.');
