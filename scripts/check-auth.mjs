import assert from 'node:assert/strict';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { onRequestPost as register } from '../functions/api/auth/register.js';
import { onRequestPost as recover } from '../functions/api/auth/recover.js';
import { onRequestPost as exchange } from '../functions/api/auth/session.js';
import { onRequestPost as updatePassword } from '../functions/api/auth/password.js';

const origin = 'https://www.raelinfo.com';
const request = (path, body, headers={}) => new Request(`${origin}${path}`, { method:'POST', headers:{ Origin:origin, 'Content-Type':'application/json', ...headers }, body:JSON.stringify(body) });
const mockDb = { prepare() { return { bind() { return this; }, async run() { return {}; }, async first() { return { hits: 1 }; } }; } };
const env = { DB: mockDb, SUPABASE_URL:'https://project.example.supabase.co', SUPABASE_PUBLISHABLE_KEY:'test-publishable-key' };
const loginInvalid = await login({ request:request('/api/auth/login',{email:'invalid',password:'x'}), env });
assert.equal(loginInvalid.status,401,'Malformed login must be rejected');
const originalFetch = globalThis.fetch;
let sentLoginPassword = null;
globalThis.fetch = async (url, options) => {
  if (String(url).includes('/auth/v1/token?grant_type=password')) {
    sentLoginPassword = JSON.parse(options.body).password;
    return new Response(JSON.stringify({ access_token:'access-token-for-test-123456789', refresh_token:'refresh-token-for-test-123456789', expires_in:3600, user:{id:'user-test-1',email:'person@example.com'} }), {status:200,headers:{'Content-Type':'application/json'}});
  }
  throw new Error('Unexpected provider request in authentication test');
};
const legacyLogin = await login({ request:request('/api/auth/login',{email:'person@example.com',password:'x'}), env });
assert.equal(legacyLogin.status,200,'Existing accounts with shorter passwords must still be able to sign in');
assert.equal(sentLoginPassword,'x','Login must pass the supplied legacy password to Supabase without a 12-character gate');
globalThis.fetch = originalFetch;
const registerShort = await register({ request:request('/api/auth/register',{email:'person@example.com',password:'short'}), env });
assert.equal(registerShort.status,400,'New registrations must require 12 characters');
const recoverInvalid = await recover({ request:request('/api/auth/recover',{email:'bad'}), env });
assert.equal(recoverInvalid.status,400,'Recovery must validate email input');
const exchangeInvalid = await exchange({ request:request('/api/auth/session',{access_token:'short',refresh_token:'short'}), env });
assert.equal(exchangeInvalid.status,400,'Email callback must reject malformed tokens');
const noCsrf = await updatePassword({ request:request('/api/auth/password',{password:'a-secure-password-123'}), env:{} });
assert.equal(noCsrf.status,403,'Password updates must require CSRF protection');
console.log('Authentication validation, recovery, callback, and CSRF checks passed.');
