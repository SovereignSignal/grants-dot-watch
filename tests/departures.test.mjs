import assert from 'node:assert/strict';
import test from 'node:test';

import { collapseStandingDepartures, collectCurrentDepartures, uniqueDeparturesByProgram } from '../src/lib/departures.ts';

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
    { ...program('paused', [{ name: 'Paused', status: 'open', closes: '2026-08-01' }]), status: 'paused' },
    { ...program('concluded', [{ name: 'Concluded', status: 'announced', closes: '2026-08-01' }]), status: 'concluded' },
  ];

  const departures = collectCurrentDepartures(programs, orgs, '2026-07-16');

  assert.deepEqual(
    departures.map((departure) => departure.program.id),
    ['sooner', 'later', 'standing']
  );
  assert.equal(departures[0].orgName, 'Funder');
});

test('uniqueDeparturesByProgram keeps the first current round per program', () => {
  const programs = [
    program('arpa', [
      { name: 'Open call A', status: 'open' },
      { name: 'Open call B', status: 'open' },
    ]),
    program('other', [{ name: 'Rolling', status: 'open' }]),
  ];
  const departures = collectCurrentDepartures(programs, orgs, '2026-07-16');
  const unique = uniqueDeparturesByProgram(departures);

  assert.deepEqual(
    unique.map((departure) => departure.program.id),
    ['arpa', 'other']
  );
});

test('collapseStandingDepartures keeps dated rounds and uniques undated programs', () => {
  const programs = [
    program('dated', [{ name: 'Wave 1', status: 'open', closes: '2026-08-01' }]),
    program('dated-two', [
      { name: 'Wave A', status: 'open', closes: '2026-08-02' },
      { name: 'Wave B', status: 'open', closes: '2026-09-01' },
    ]),
    program('arpa', [
      { name: 'Open call A', status: 'open' },
      { name: 'Open call B', status: 'open' },
    ]),
  ];
  const collapsed = collapseStandingDepartures(collectCurrentDepartures(programs, orgs, '2026-07-16'));

  assert.deepEqual(
    collapsed.map((departure) => `${departure.program.id}:${departure.round.name}`),
    ['dated:Wave 1', 'dated-two:Wave A', 'dated-two:Wave B', 'arpa:Open call A']
  );
});
