import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { PrivyClient } from '@privy-io/node';
import { checkAuth } from '../src/app/api/desk/lib.ts';

const records = new Map();
const fetchCounts = new Map();
const originalFetch = globalThis.fetch;
const originalUtils = PrivyClient.prototype.utils;
const originalEnv = new Map(
  ['ADMIN_TOKEN', 'NEXT_PUBLIC_PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'DESK_OWNERS']
    .map((key) => [key, process.env[key]]),
);

function requestFor(did) {
  return new Request('https://grants.watch/api/desk/proposals', {
    headers: { authorization: `Bearer ${did}` },
  });
}

before(() => {
  process.env.ADMIN_TOKEN = 'machine-token-for-tests';
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = 'test-privy-app';
  process.env.PRIVY_APP_SECRET = 'test-privy-secret';
  process.env.DESK_OWNERS = 'owner@example.com';

  PrivyClient.prototype.utils = function utils() {
    return {
      auth: () => ({
        verifyAccessToken: async (token) => ({ user_id: token }),
      }),
    };
  };

  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const did = decodeURIComponent(url.pathname.split('/').at(-1));
    fetchCounts.set(did, (fetchCounts.get(did) || 0) + 1);
    if (!records.has(did)) return Response.json({ error: 'missing fixture' }, { status: 404 });
    return Response.json(records.get(did));
  };
});

after(() => {
  globalThis.fetch = originalFetch;
  PrivyClient.prototype.utils = originalUtils;
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('authorizes an allowlisted explicit email login', async () => {
  records.set('did-email', {
    id: 'did-email',
    linked_accounts: [{ type: 'email', address: ' owner@example.com ' }],
  });

  assert.deepEqual(await checkAuth(requestFor('did-email')), { ok: true });
});

test('rejects a Google-only login even when its email is allowlisted', async () => {
  records.set('did-google', {
    id: 'did-google',
    linked_accounts: [{ type: 'google_oauth', email: 'owner@example.com' }],
  });

  assert.deepEqual(await checkAuth(requestFor('did-google')), { ok: false });
});

test('rejects unlisted and malformed linked accounts', async () => {
  records.set('did-unlisted', {
    id: 'did-unlisted',
    linked_accounts: [{ type: 'email', address: 'someone-else@example.com' }],
  });
  records.set('did-malformed', {
    id: 'did-malformed',
    linked_accounts: [
      null,
      'owner@example.com',
      { type: 'email', email: 'owner@example.com' },
      { type: 'google_oauth', address: 'owner@example.com' },
      { type: 'github_oauth', email: 'owner@example.com' },
    ],
  });
  records.set('did-malformed-record', { id: 'did-malformed-record', linked_accounts: {} });

  assert.deepEqual(await checkAuth(requestFor('did-unlisted')), { ok: false });
  assert.deepEqual(await checkAuth(requestFor('did-malformed')), { ok: false });
  assert.deepEqual(await checkAuth(requestFor('did-malformed-record')), { ok: false });
});

test('caches the server-verified email for repeated requests', async () => {
  records.set('did-cache', {
    id: 'did-cache',
    linked_accounts: [{ type: 'email', address: 'owner@example.com' }],
  });

  assert.deepEqual(await checkAuth(requestFor('did-cache')), { ok: true });
  records.set('did-cache', {
    id: 'did-cache',
    linked_accounts: [{ type: 'email', address: 'someone-else@example.com' }],
  });
  assert.deepEqual(await checkAuth(requestFor('did-cache')), { ok: true });
  assert.equal(fetchCounts.get('did-cache'), 1);
});
