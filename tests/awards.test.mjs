import assert from 'node:assert/strict';
import test from 'node:test';

import { awardAmountLabel, awardMatchesProgram, sortAwardsNewest } from '../src/lib/awards.ts';

const program = {
  id: 'public-goods-round',
  name: 'Public Goods Round',
  org: 'example-foundation',
};

function award(overrides = {}) {
  return {
    funder: 'example-foundation',
    grantee: 'recipient',
    grantee_name: 'Recipient',
    amount: null,
    currency: null,
    amount_text: null,
    date: null,
    program: null,
    program_name: null,
    key: 'example|recipient',
    ...overrides,
  };
}

test('program awards match a curated ID or funder-scoped exact name', () => {
  assert.equal(awardMatchesProgram(award({ program: program.id }), program), true);
  assert.equal(awardMatchesProgram(award({ program_name: ' public goods round ' }), program), true);
  assert.equal(awardMatchesProgram(award({ funder: 'another-funder', program_name: program.name }), program), false);
  assert.equal(awardMatchesProgram(award({ program: 'another-program', program_name: program.name }), program), false);
});

test('awards sort newest first and leave undated evidence last', () => {
  const sorted = sortAwardsNewest([
    award({ key: 'undated', grantee_name: 'A' }),
    award({ key: 'older', date: '2025-01-02' }),
    award({ key: 'newer', date: '2026-06-01' }),
  ]);
  assert.deepEqual(sorted.map((item) => item.key), ['newer', 'older', 'undated']);
});

test('award amount labels preserve source text and format numeric fallbacks', () => {
  assert.equal(awardAmountLabel(award({ amount: 12500, currency: 'USD', amount_text: '$12,500 exact' })), '$12,500 exact');
  assert.equal(awardAmountLabel(award({ amount: 12500, currency: 'USD' })), '$12,500');
  assert.equal(awardAmountLabel(award({ amount: 12500, currency: 'ARB' })), '12,500 ARB');
  assert.equal(awardAmountLabel(award()), 'Not recorded');
});
