import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../public/app.js');
const portfolio = read('../public/portfolio.js');
const priceAlerts = read('../public/price-alerts.js');
const watchlists = read('../public/watchlists.js');
const deletion = read('../functions/api/auth/delete.js');
const auth = read('../functions-shared/supabase-auth.js');
const http = read('../functions-shared/http.js');

assert.match(app, /setPortfolioAuth\(session\.authenticated,\s*session\.csrfToken,\s*session\.accountDeletionEnabled,\s*session\.deletionPending\)/,
  'The app must pass the deletion-pending session state into the portfolio UI.');

assert.match(portfolio, /deletionPending = false\)/,
  'The portfolio auth initializer must accept the deletion-pending state.');
assert.match(portfolio, /authenticated = sessionAuthenticated && !accountDeletionPending/,
  'Pending accounts must not be treated as available for normal account features.');
assert.match(portfolio, /setPriceAlertsAuth\(authenticated, token\)/,
  'Price alerts must be disabled when deletion is pending.');
assert.match(portfolio, /deletePanel\.hidden = !sessionAuthenticated \|\| \(!accountDeletionEnabled && !accountDeletionPending\)/,
  'The permanent deletion panel must remain visible to authenticated pending accounts.');
assert.match(portfolio, /accountDeletionPending && !accountDeletionEnabled/,
  'Pending accounts must not be offered a retry when the deletion service is unavailable.');
assert.match(portfolio, /support@raelinfo\.com/,
  'Pending accounts must see the support contact when deletion is unavailable.');
assert.match(portfolio, /Retry permanent deletion/,
  'The pending account UI must clearly offer the retry action.');
assert.match(portfolio, /skip|DELETE MY ACCOUNT/,
  'The account deletion confirmation flow must remain present.');

assert.match(priceAlerts, /if \(!authenticated\) return/,
  'Price-alert loading must be blocked when the portfolio auth state is unavailable.');

assert.match(watchlists, /auth\.deletionPending/,
  'The independently initialized watchlists UI must reject pending-deletion sessions.');
assert.match(watchlists, /Watchlists are locked while deletion is being completed/,
  'Pending users must receive an explicit watchlist lock message.');

assert.match(auth, /skipProfileEnsure = false/,
  'Authentication must support the deletion-only path that skips profile recreation.');
assert.match(auth, /!skipProfileEnsure/,
  'Normal authentication must continue to enforce profile creation and pending-account checks.');
assert.match(http, /ACCOUNT_DELETION_PENDING/,
  'Profile creation must reject accounts with a pending deletion marker.');

const requiredDeletionSteps = [
  'skipProfileEnsure: true',
  "confirmation !== 'DELETE MY ACCOUNT'",
  'await signInWithSupabase(env, auth.user.email, password)',
  'INSERT INTO account_deletion_pending',
  "DELETE FROM users WHERE id = ?",
  'await deleteSupabaseUser(env, auth.user.id, auth.accessToken)',
  "DELETE FROM account_deletion_pending WHERE user_id = ?",
  'Account deletion is already pending.'
];
let lastIndex = -1;
for (const step of requiredDeletionSteps) {
  const index = deletion.indexOf(step);
  assert.notEqual(index, -1, `Deletion retry safety requirement missing: ${step}`);
  assert.ok(index > lastIndex, `Deletion retry sequence is out of order at: ${step}`);
  lastIndex = index;
}

assert.match(deletion, /Account deletion is already pending\.[\s\S]*?423/,
  'A retry failure must preserve the pending lock and return a locked response.');

assert.match(deletion, /enforceRateLimit\(\s*env,\s*request,\s*'account-delete',\s*5,\s*900,\s*auth\.user\.id\s*\)/,
  'Permanent deletion password attempts must be rate-limited to five per 15 minutes per user and IP.');
assert.match(deletion, /if\s*\(!rate\.allowed\)[\s\S]*?429[\s\S]*?Retry-After/,
  'Rate-limited deletion attempts must return HTTP 429 and Retry-After.');

const deletionRateLimitMatch = deletion.match(/enforceRateLimit\(\s*env,\s*request,\s*'account-delete',\s*5,\s*900,\s*auth\.user\.id\s*\)/);
const deletionRateLimitIndex = deletionRateLimitMatch?.index ?? -1;
const passwordVerificationIndex = deletion.indexOf('await signInWithSupabase(env, auth.user.email, password)');
assert.ok(
  deletionRateLimitIndex !== -1 &&
  passwordVerificationIndex !== -1 &&
  deletionRateLimitIndex < passwordVerificationIndex,
  'The deletion rate limit must run before password verification.'
);

assert.match(deletion, /let deletionMarked = false/,
  'The endpoint must track whether the pending-deletion batch completed.');
assert.match(deletion, /deletionMarked = true/,
  'The endpoint must mark the account as pending only after the D1 batch succeeds.');
assert.match(deletion, /if \(deletionMarked\)[\s\S]*?Normal account access is locked/,
  'A post-marker failure must explicitly preserve the account lock.');
assert.match(deletion, /if \(deletionMarked\)[\s\S]*?503/,
  'A post-marker failure must return a retryable server response.');
assert.match(deletion, /Account deletion could not be started\. Your account deletion was not confirmed/,
  'A pre-marker failure must not falsely claim that the account is locked.');

assert.match(portfolio, /requestError\.status = response\.status/,
  'The frontend API helper must preserve HTTP status codes.');
assert.match(portfolio, /if \(error\.status === 503\)[\s\S]*?location\.reload\(\)/,
  'The deletion UI must reload after a potentially pending server failure.');

console.log('Account deletion UI lockout, retry controls, and backend retry safety checks passed.');