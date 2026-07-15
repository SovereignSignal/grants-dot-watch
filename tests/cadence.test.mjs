import assert from 'node:assert/strict';
import test from 'node:test';

import { cadenceFallback, hasVerifiedRollingIntake, hasYearCadence } from '../src/lib/cadence.ts';

function program(rounds = []) {
  return { rounds };
}

test('only explicit live undated rounds count as rolling intake', () => {
  assert.equal(hasVerifiedRollingIntake(program([])), false);
  assert.equal(hasVerifiedRollingIntake(program([{ status: 'closed' }])), false);
  assert.equal(hasVerifiedRollingIntake(program([{ status: 'open' }])), true);
  assert.equal(hasVerifiedRollingIntake(program([{ status: 'open', closes: '2026-08-01' }])), false);
});

test('current cadence includes year dates and verified rolling rounds', () => {
  assert.equal(hasYearCadence(program([{ status: 'closed', closes: '2026-04-01' }]), 2026), true);
  assert.equal(hasYearCadence(program([{ status: 'open' }]), 2026), true);
  assert.equal(hasYearCadence(program([{ status: 'closed', closes: '2025-04-01' }]), 2026), false);
});

test('fallback labels preserve unknown and historical states', () => {
  assert.deepEqual(cadenceFallback(program([]), 2026), { label: 'No cadence on file', rolling: false });
  assert.deepEqual(cadenceFallback(program([{ status: 'closed' }]), 2026), { label: 'No dates on file', rolling: false });
  assert.deepEqual(cadenceFallback(program([{ status: 'closed', closes: '2025-01-01' }]), 2026), {
    label: 'No 2026 dates',
    rolling: false,
  });
});
