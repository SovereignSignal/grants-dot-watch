import assert from 'node:assert/strict';
import { statSync, utimesSync } from 'node:fs';
import test from 'node:test';

import { invalidateRegistryCache, loadRegistry } from '../src/lib/registry.ts';

const TOUCH = 'registry/programs/nlnet-general-grants.yaml';

test('loadRegistry reloads when a registry file mtime changes', () => {
  invalidateRegistryCache();
  const first = loadRegistry();
  const same = loadRegistry();
  assert.equal(same.updatedAt, first.updatedAt);

  const st = statSync(TOUCH);
  utimesSync(TOUCH, st.atime, new Date(st.mtimeMs + 2000));
  try {
    const second = loadRegistry();
    assert.notEqual(second.updatedAt, first.updatedAt);
  } finally {
    utimesSync(TOUCH, st.atime, st.mtime);
    invalidateRegistryCache();
  }
});
