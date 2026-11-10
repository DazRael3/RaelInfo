import assert from 'node:assert/strict';
import { enforceRateLimit } from '../functions-shared/rate-limit.js';

const rows = new Map();

const db = {
  prepare(sql) {
    let values = [];

    return {
      bind(...args) {
        values = args;
        return this;
      },

      async run() {
        if (sql.includes('INSERT INTO rate_limits')) {
          const [bucket, window] = values;
          const initialHits = 1;
          const key = `${bucket}:${window}`;
          const existing = rows.get(key);

          rows.set(key, {
            hits: existing ? existing.hits + 1 : initialHits
          });
        }

        return {};
      },

      async first() {
        if (sql.includes('SELECT hits')) {
          const [bucket, window] = values;
          return rows.get(`${bucket}:${window}`) || { hits: 0 };
        }

        return null;
      }
    };
  }
};

const env = { DB: db };

function request(ip) {
  return new Request('https://www.raelinfo.com/api/auth/recover', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip }
  });
}

const sharedIp = '192.0.2.10';

for (let i = 0; i < 3; i++) {
  const result = await enforceRateLimit(
    env, request(sharedIp), 'auth-recover-email', 3, 900,
    'first@example.com'
  );
  assert.equal(result.allowed, true);
}

const fourthSameEmail = await enforceRateLimit(
  env, request(sharedIp), 'auth-recover-email', 3, 900,
  'first@example.com'
);
assert.equal(fourthSameEmail.allowed, false);

const differentEmail = await enforceRateLimit(
  env, request(sharedIp), 'auth-recover-email', 3, 900,
  'second@example.com'
);
assert.equal(differentEmail.allowed, true);

const differentIp = await enforceRateLimit(
  env, request('192.0.2.11'), 'auth-recover-email', 3, 900,
  'first@example.com'
);
assert.equal(differentIp.allowed, true);

for (let i = 0; i < 30; i++) {
  const result = await enforceRateLimit(
    env, request('192.0.2.20'), 'auth-recover-ip', 30, 900
  );
  assert.equal(result.allowed, true);
}

const thirtyFirstIpRequest = await enforceRateLimit(
  env, request('192.0.2.20'), 'auth-recover-ip', 30, 900
);
assert.equal(thirtyFirstIpRequest.allowed, false);

console.log('PASS: Three recovery requests per IP/email pair are allowed.');
console.log('PASS: The fourth request for the same email is blocked.');
console.log('PASS: Different email addresses sharing an IP have independent limits.');
console.log('PASS: Different IP addresses have independent email limits.');
console.log('PASS: The 30-request IP safety limit is enforced.');
console.log('All recovery rate-limit tests passed.');
