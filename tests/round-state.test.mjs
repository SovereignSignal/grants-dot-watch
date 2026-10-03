import assert from 'node:assert/strict';
import test from 'node:test';

import {
  effectiveRoundLabel,
  isCurrentRound,
  isVerifiedRollingRound,
  mostCurrentRound,
  productDateISO,
} from '../src/lib/round-state.ts';

function program(status = 'active', rounds = []) {
  return { id: 'program', name: 'Program', org: 'org', systems: [], wires: [], status, summary: '', sources: [], rounds };
}

test('product date stays on the Pacific business day across UTC midnight', () => {
  assert.equal(productDateISO(new Date('2026-07-22T00:30:00Z')), '2026-07-21');
  assert.equal(productDateISO(new Date('2026-07-22T07:30:00Z')), '2026-07-22');
  assert.equal(productDateISO(new Date('2026-12-22T07:30:00Z')), '2026-12-21');
  assert.equal(productDateISO(new Date('2026-12-22T08:30:00Z')), '2026-12-22');
});

test('current rounds respect program state, round state, and date-only closes', () => {
  const open = { name: 'Open', status: 'open', closes: '2026-07-21' };
  assert.equal(isCurrentRound(program('active', [open]), open, '2026-07-21'), true);
  assert.equal(isCurrentRound(program('active', [open]), open, '2026-07-22'), false);
  assert.equal(isCurrentRound(program('paused', [open]), open, '2026-07-21'), false);
  assert.equal(isCurrentRound(program('concluded', [open]), open, '2026-07-21'), false);
  assert.equal(isCurrentRound(program('active'), { ...open, status: 'reviewing' }, '2026-07-21'), false);
  assert.equal(isCurrentRound(program('active'), { name: 'Dup', status: 'duplicate', closes: '2026-10-07' }, '2026-07-21'), false);
  assert.equal(isCurrentRound(program('active'), { name: 'Gone', status: 'withdrawn', closes: '2026-10-07' }, '2026-07-21'), false);
  assert.equal(effectiveRoundLabel(program('active'), { name: 'Dup', status: 'duplicate' }, '2026-07-21'), 'Duplicate');
  assert.equal(effectiveRoundLabel(program('active'), { name: 'Gone', status: 'withdrawn' }, '2026-07-21'), 'Withdrawn');
});

test('only an open undated intake is rolling', () => {
  const open = { name: 'Open intake', status: 'open' };
  const announced = { name: 'Dates pending', status: 'announced' };
  const active = program('active', [open, announced]);
  assert.equal(isVerifiedRollingRound(active, open, '2026-07-21'), true);
  assert.equal(isVerifiedRollingRound(active, announced, '2026-07-21'), false);
});

test('most-current selection ignores stale and paused open records', () => {
  const stale = { name: 'Stale', status: 'open', closes: '2026-07-20' };
  const announced = { name: 'Upcoming', status: 'announced', closes: '2026-08-02' };
  const live = { name: 'Live', status: 'open', closes: '2026-08-10' };
  assert.equal(mostCurrentRound(program('active', [stale, announced, live]), '2026-07-21')?.name, 'Live');
  assert.equal(mostCurrentRound(program('paused', [live]), '2026-07-21'), null);
  assert.equal(effectiveRoundLabel(program('paused', [live]), live, '2026-07-21'), 'Paused');
  assert.equal(effectiveRoundLabel(program('active', [stale]), stale, '2026-07-21'), 'Closed');
});
