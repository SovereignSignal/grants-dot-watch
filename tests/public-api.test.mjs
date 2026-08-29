import assert from 'node:assert/strict';
import test from 'node:test';

import { collectCurrentDepartures } from '../src/lib/departures.ts';
import {
  apiIndex,
  filterPrograms,
  getRecord,
  liveBoard,
  liveCounts,
  parseLimit,
  publicOrg,
  publicProgram,
  queryCollection,
  queryOpen,
} from '../src/lib/public-api.ts';
import { loadRegistry } from '../src/lib/registry.ts';

const FORBIDDEN = /relationship_context|propensity|current_wedge|recommended_action|operator_read|watch_priority/;

test('parseLimit defaults and caps page size', () => {
  assert.equal(parseLimit(null), 50);
  assert.equal(parseLimit('0'), 50);
  assert.equal(parseLimit('12'), 12);
  assert.equal(parseLimit('1000'), 100);
});

test('live programs filter matches current departures', () => {
  const registry = loadRegistry();
  const today = '2026-08-29';
  const live = filterPrograms(registry.programs, new URLSearchParams('live=1'), today);
  const departures = collectCurrentDepartures(registry.programs, registry.orgs, today);
  assert.ok(live.length > 0);
  assert.equal(live.length, new Set(departures.map((row) => row.program.id)).size);
  assert.ok(live.every((program) => program.id !== 'nominet-dns-fund'));
});

test('open board omits past closes and paginates', () => {
  const registry = loadRegistry();
  const board = liveBoard(registry, '2026-08-29');
  assert.ok(board.every((row) => !row.round.closes || row.round.closes >= '2026-08-29'));
  assert.ok(!board.some((row) => row.program_id === 'darpa-dice-baa-hr001126s0010'));

  const dated = queryOpen(new URLSearchParams('standing=0&limit=5'), registry);
  assert.equal(dated.data.length <= 5, true);
  assert.equal(dated.meta.page, 1);
  assert.ok(dated.data.every((row) => row.standing === false));
});

test('public records stay on the public field set', () => {
  const registry = loadRegistry();
  const org = publicOrg(registry.orgs[0], registry);
  const program = publicProgram(registry.programs[0], '2026-08-29');
  const blob = JSON.stringify({ org, program, index: apiIndex(registry) });
  assert.equal(FORBIDDEN.test(blob), false);
  assert.ok(org.href.startsWith('/orgs/'));
  assert.ok(program.api.startsWith('/api/v1/programs/'));
  assert.equal('relationship_context' in org, false);
});

test('collection query and record lookup stay consistent', () => {
  const registry = loadRegistry();
  const orgs = queryCollection('orgs', new URLSearchParams('role=funder&limit=10'), registry);
  assert.ok(orgs.data.length > 0);
  assert.ok(orgs.data.every((org) => org.roles.includes('funder')));
  const first = orgs.data[0];
  const one = getRecord('orgs', first.id, registry);
  assert.equal(one?.id, first.id);

  const missing = getRecord('programs', 'does-not-exist', registry);
  assert.equal(missing, null);
});

test('live counts split dated and standing', () => {
  const registry = loadRegistry();
  const counts = liveCounts(registry, '2026-08-29');
  assert.equal(counts.total, counts.dated + counts.standing);
  assert.ok(counts.dated >= 1);
});
