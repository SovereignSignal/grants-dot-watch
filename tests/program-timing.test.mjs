import assert from 'node:assert/strict';
import test from 'node:test';

import { groupDeparturesByProgram, summarizeProgramTiming } from '../src/lib/program-timing.ts';

const orgs = [{ id: 'funder', name: 'Funder' }];

function program(id, status, rounds) {
  return { id, name: id, org: 'funder', status, rounds };
}

test('timing summary keeps fixed, missing, announced, and absent timing states separate', () => {
  const programs = [
    program('dated', 'active', [{ name: 'Dated', status: 'open', closes: '2026-08-01' }]),
    program('undated', 'active', [
      { name: 'One', status: 'open' },
      { name: 'Two', status: 'open', opens: '2026-07-01' },
    ]),
    program('announced', 'announced', [{ name: 'Later', status: 'announced' }]),
    program('history-only', 'active', [{ name: 'Past', status: 'closed', closes: '2026-06-01' }]),
    program('paused', 'paused', [{ name: 'Paused', status: 'open' }]),
  ];

  const summary = summarizeProgramTiming(programs, orgs, '2026-07-22');

  assert.equal(summary.openWithDeadline.length, 1);
  assert.equal(summary.openWithoutDeadline.length, 2);
  assert.equal(summary.announced.length, 1);
  assert.equal(summary.currentProgramCount, 3);
  assert.equal(summary.activeOrAnnouncedWithoutCurrentRound, 1);
  assert.deepEqual(groupDeparturesByProgram(summary.openWithoutDeadline).map((group) => [group.program.id, group.rounds.length]), [
    ['undated', 2],
  ]);
});
