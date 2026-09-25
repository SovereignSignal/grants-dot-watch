import assert from 'node:assert/strict';
import test from 'node:test';

import { cadenceFallback, hasOpenRoundWithoutDeadline, hasYearCadence } from '../src/lib/cadence.ts';

function program(rounds = []) {
  return { status: 'active', rounds };
}

test('only live open rounds without a close date count as missing a deadline', () => {
  assert.equal(hasOpenRoundWithoutDeadline(program([])), false);
  assert.equal(hasOpenRoundWithoutDeadline(program([{ status: 'closed' }])), false);
  assert.equal(hasOpenRoundWithoutDeadline(program([{ status: 'open' }])), true);
  assert.equal(hasOpenRoundWithoutDeadline(program([{ status: 'announced' }])), false);
  assert.equal(hasOpenRoundWithoutDeadline(program([{ status: 'open', closes: '2026-08-01' }])), false);
  assert.equal(hasOpenRoundWithoutDeadline({ status: 'paused', rounds: [{ status: 'open' }] }), false);
});

test('current cadence includes year dates and open rounds without a deadline', () => {
  assert.equal(hasYearCadence(program([{ status: 'closed', closes: '2026-04-01' }]), 2026), true);
  assert.equal(hasYearCadence(program([{ status: 'open' }]), 2026), true);
  assert.equal(hasYearCadence(program([{ status: 'closed', closes: '2025-04-01' }]), 2026), false);
});

test('fallback labels preserve unknown and historical states', () => {
  assert.deepEqual(cadenceFallback(program([]), 2026), { label: 'No cadence on file', openWithoutDeadline: false });
  assert.deepEqual(cadenceFallback(program([{ status: 'open' }]), 2026), {
    label: 'No close date on file',
    openWithoutDeadline: true,
  });
  assert.deepEqual(cadenceFallback(program([{ status: 'closed' }]), 2026), { label: 'No dates on file', openWithoutDeadline: false });
  assert.deepEqual(cadenceFallback(program([{ status: 'closed', closes: '2025-01-01' }]), 2026), {
    label: 'No 2026 dates',
    openWithoutDeadline: false,
  });
});
