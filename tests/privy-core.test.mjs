import assert from 'node:assert/strict';
import test from 'node:test';

import { readPrivyOAuthCallback, stripPrivyOAuthParams } from '../src/app/admin/privy-core.ts';

test('recognizes complete and incomplete Privy OAuth callbacks', () => {
  assert.deepEqual(
    readPrivyOAuthCallback('?privy_oauth_code=code-123&privy_oauth_state=state-456&privy_oauth_provider=google'),
    { code: 'code-123', state: 'state-456' }
  );
  assert.deepEqual(readPrivyOAuthCallback('?privy_oauth_provider=google'), { code: null, state: null });
  assert.equal(readPrivyOAuthCallback('?code=unrelated&state=unrelated'), null);
  assert.equal(readPrivyOAuthCallback(''), null);
});

test('strips Privy callback credentials while preserving the callback URL shape', () => {
  const input = new URL(
    'https://example.test/admin/auth/callback?keep=one&privy_oauth_code=secret&privy_oauth_state=state&privy_oauth_provider=google&keep=two#done'
  );

  assert.equal(stripPrivyOAuthParams(input), '/admin/auth/callback?keep=one&keep=two#done');
  assert.equal(input.searchParams.get('privy_oauth_code'), 'secret');
});

test('leaves ordinary admin URLs unchanged', () => {
  assert.equal(
    stripPrivyOAuthParams(new URL('https://example.test/admin/desk?filter=pending#queue')),
    '/admin/desk?filter=pending#queue'
  );
});
