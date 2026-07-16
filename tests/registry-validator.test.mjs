import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('registry remains valid after the July 15 deadline rollovers', () => {
  const output = execFileSync(process.execPath, ['scripts/validate-registry.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, VALIDATION_TODAY: '2026-07-16' },
  });

  assert.match(output, /^OK: 21 systems, 406 orgs, 588 programs validated/m);
});
