import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/auth/delete.js';

const ORIGIN = 'https://www.raelinfo.com';
const USER = {
  id: 'runtime-deletion-user',
  email: 'runtime-deletion@example.test'
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createHarness(options = {}) {
  const state = {
    pending: new Set(),
    profiles: new Set([USER.id]),
    rateLimits: new Map(),
    authUserExists: true,
    adminDeleteFailures: options.adminDeleteFailures || 0,
    failBatch: Boolean(options.failBatch),
    password: 'Correct-Test-Password-123!',
    passwordChecks: 0,
    adminDeleteCalls: 0
  };

  const db = {
    prepare(sql) {
      let values = [];

      return {
        sql,
        bind(...args) {
          values = args;
          this.values = values;
          return this;
        },

        async run() {
          if (sql.includes('DELETE FROM rate_limits')) {
            return { meta: { changes: 0 } };
          }

          if (sql.includes('INSERT INTO rate_limits')) {
            const [bucket, window] = values;
            const key = `${bucket}:${window}`;
            state.rateLimits.set(key, (state.rateLimits.get(key) || 0) + 1);
            return { meta: { changes: 1 } };
          }

          if (sql.includes('DELETE FROM account_deletion_pending')) {
            state.pending.delete(values[0]);
            return { meta: { changes: 1 } };
          }

          throw new Error(`Unexpected test database run: ${sql}`);
        },

        async first() {
          if (sql.includes('SELECT hits FROM rate_limits')) {
            const [bucket, window] = values;
            return { hits: state.rateLimits.get(`${bucket}:${window}`) || 0 };
          }

          throw new Error(`Unexpected test database first: ${sql}`);
        }
      };
    },

    async batch(statements) {
      if (state.failBatch) {
        throw new Error('Simulated D1 batch failure');
      }

      // Apply the mock batch only after the failure check, mirroring atomicity.
      for (const statement of statements) {
        if (statement.sql.includes('INSERT INTO account_deletion_pending')) {
          state.pending.add(statement.values[0]);
        } else if (statement.sql.includes('DELETE FROM users')) {
          state.profiles.delete(statement.values[0]);
        } else {
          throw new Error(`Unexpected test database batch statement: ${statement.sql}`);
        }
      }

      return [];
    }
  };

  const env = {
    DB: db,
    SUPABASE_URL: 'https://example-project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    SUPABASE_SECRET_KEY: 'test-admin-secret'
  };

  async function mockedFetch(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method || 'GET';

    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      if (!state.authUserExists) {
        return jsonResponse({ message: 'User not found' }, 401);
      }
      return jsonResponse(USER);
    }

    if (
      url.pathname === '/auth/v1/token' &&
      url.searchParams.get('grant_type') === 'password' &&
      method === 'POST'
    ) {
      state.passwordChecks += 1;
      const body = JSON.parse(init.body || '{}');

      if (body.email !== USER.email || body.password !== state.password) {
        return jsonResponse({ message: 'Invalid login credentials' }, 400);
      }

      return jsonResponse({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        user: USER
      });
    }

    if (
      url.pathname === `/auth/v1/admin/users/${encodeURIComponent(USER.id)}` &&
      method === 'DELETE'
    ) {
      state.adminDeleteCalls += 1;

      if (state.adminDeleteFailures > 0) {
        state.adminDeleteFailures -= 1;
        return jsonResponse({ message: 'Simulated Supabase deletion failure' }, 500);
      }

      state.authUserExists = false;
      return jsonResponse({ id: USER.id });
    }

    throw new Error(`Unexpected outbound request in test: ${method} ${url.pathname}`);
  }

  async function post(body) {
    const request = new Request(`${ORIGIN}/api/auth/delete`, {
      method: 'POST',
      headers: {
        'Origin': ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
        'Cookie': 'raelinfo_access=test-access-token; raelinfo_csrf=test-csrf-token',
        'X-CSRF-Token': 'test-csrf-token'
      },
      body: JSON.stringify(body)
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockedFetch;

    try {
      return await onRequestPost({ request, env });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  return { state, post };
}

const validBody = {
  password: 'Correct-Test-Password-123!',
  confirmation: 'DELETE MY ACCOUNT'
};

// 1. Incorrect confirmation phrase must not verify the password or delete anything.
{
  const h = createHarness();
  const response = await h.post({
    password: validBody.password,
    confirmation: 'DELETE ACCOUNT'
  });

  assert.equal(response.status, 400);
  assert.equal(h.state.passwordChecks, 0);
  assert.equal(h.state.adminDeleteCalls, 0);
  assert.equal(h.state.pending.has(USER.id), false);
  assert.equal(h.state.profiles.has(USER.id), true);
  console.log('PASS: Incorrect confirmation phrase is rejected safely.');
}

// 2. Incorrect password must not create a pending marker or delete the profile.
{
  const h = createHarness();
  const response = await h.post({
    password: 'Wrong-Test-Password',
    confirmation: validBody.confirmation
  });

  assert.equal(response.status, 401);
  assert.equal(h.state.passwordChecks, 1);
  assert.equal(h.state.adminDeleteCalls, 0);
  assert.equal(h.state.pending.has(USER.id), false);
  assert.equal(h.state.profiles.has(USER.id), true);
  console.log('PASS: Incorrect password cannot start account deletion.');
}

// 3. A D1 batch failure must not claim that deletion is pending.
{
  const h = createHarness({ failBatch: true });
  const response = await h.post(validBody);
  const result = await response.json();

  assert.equal(response.status, 503);
  assert.match(result.error, /could not be started/i);
  assert.doesNotMatch(result.error, /Normal account access is locked/i);
  assert.equal(h.state.pending.has(USER.id), false);
  assert.equal(h.state.profiles.has(USER.id), true);
  assert.equal(h.state.adminDeleteCalls, 0);
  console.log('PASS: Pre-marker database failure does not falsely claim account lockout.');
}

// 4. A Supabase failure after the D1 batch must preserve the pending lock.
//    A second authenticated request must be able to retry and finish deletion.
{
  const h = createHarness({ adminDeleteFailures: 1 });

  const first = await h.post(validBody);
  const firstBody = await first.json();

  assert.equal(first.status, 503);
  assert.match(firstBody.error, /Normal account access is locked/i);
  assert.equal(h.state.pending.has(USER.id), true);
  assert.equal(h.state.profiles.has(USER.id), false);
  assert.equal(h.state.authUserExists, true);

  const retry = await h.post(validBody);
  assert.equal(retry.status, 200);
  assert.equal(h.state.pending.has(USER.id), false);
  assert.equal(h.state.profiles.has(USER.id), false);
  assert.equal(h.state.authUserExists, false);
  assert.equal(h.state.adminDeleteCalls, 2);

  const cookieHeader = retry.headers.get('Set-Cookie') || '';
  assert.match(cookieHeader, /raelinfo_access=/);
  assert.match(cookieHeader, /Max-Age=0/);
  assert.match(cookieHeader, /raelinfo_refresh=/);
  assert.match(cookieHeader, /raelinfo_csrf=/);

  console.log('PASS: Failed Supabase deletion preserves lock; authenticated retry completes deletion and clears cookies.');
}

// 5. Five failed provider deletions are allowed; the sixth request is rate-limited.
{
  const h = createHarness({ adminDeleteFailures: 10 });

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await h.post(validBody);
    assert.equal(response.status, 503, `Attempt ${attempt} should reach the simulated provider failure.`);
    assert.equal(h.state.pending.has(USER.id), true);
  }

  const passwordChecksBeforeSixth = h.state.passwordChecks;
  const adminCallsBeforeSixth = h.state.adminDeleteCalls;

  const sixth = await h.post(validBody);
  const sixthBody = await sixth.json();

  assert.equal(sixth.status, 429);
  assert.match(sixthBody.error, /Too many permanent deletion attempts/i);
  assert.ok(sixth.headers.get('Retry-After'));
  assert.equal(h.state.passwordChecks, passwordChecksBeforeSixth);
  assert.equal(h.state.adminDeleteCalls, adminCallsBeforeSixth);
  assert.equal(h.state.pending.has(USER.id), true);

  console.log('PASS: Sixth deletion attempt is rate-limited; pending lock remains intact.');
}

console.log('\nAll account deletion runtime regression tests passed.');