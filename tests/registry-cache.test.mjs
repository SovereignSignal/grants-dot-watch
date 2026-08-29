import assert from 'node:assert/strict';
import { statSync, utimesSync } from 'node:fs';
import test from 'node:test';

import { invalidateRegistryCache, loadRegistry } from '../src/lib/registry.ts';

const TOUCH = 'registry/programs/nlnet-general-grants.yaml';

test('loadRegistry reloads when a registry file mtime changes', () => {
  invalidateRegistryCache();
  const first = loadRegistry();
  assert.equal(loadRegistry(), first);

  const st = statSync(TOUCH);
  // Beat every other registry file, not just this file's own mtime.
  const later = new Date(Date.now() + 5000);
  utimesSync(TOUCH, st.atime, later);
  try {
    const second = loadRegistry();
    assert.notEqual(second, first);
    assert.notEqual(second.updatedAt, first.updatedAt);
  } finally {
    utimesSync(TOUCH, st.atime, st.mtime);
    invalidateRegistryCache();
  }
});
