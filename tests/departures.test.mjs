import assert from 'node:assert/strict';
import test from 'node:test';

import { collectCurrentDepartures } from '../src/lib/departures.ts';

const orgs = [{ id: 'funder', name: 'Funder' }];

function program(id, rounds) {
  return { id, name: id, org: 'funder', status: 'active', rounds };
}

test('current departures sort dated calls first and omit closed or stale rounds', () => {
  const programs = [
    program('standing', [{ name: 'Rolling', status: 'open' }]),
    program('later', [{ name: 'Later', status: 'announced', closes: '2026-09-01' }]),
    program('closed', [{ name: 'Closed', status: 'closed', closes: '2026-08-01' }]),
    program('past', [{ name: 'Past', status: 'open', closes: '2026-07-01' }]),
    program('sooner', [{ name: 'Sooner', status: 'open', closes: '2026-08-01' }]),
  ];

  const departures = collectCurrentDepartures(programs, orgs, '2026-07-16');

  assert.deepEqual(
    departures.map((departure) => departure.program.id),
    ['sooner', 'later', 'standing']
  );
  assert.equal(departures[0].orgName, 'Funder');
});
