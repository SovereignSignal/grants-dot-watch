import assert from 'node:assert/strict';
import test from 'node:test';

import { collectCurrentDepartures } from '../src/lib/departures.ts';
import {
  apiIndex,
  briefingBoard,
  isOrgHomepageApply,
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

test('standing currency reset drops closed undated calls', () => {
  const registry = loadRegistry();
  const board = liveBoard(registry, '2026-08-29');
  const ids = new Set(board.map((row) => row.program_id));
  for (const id of [
    'foresight-ai-science-safety-nodes',
    'mozilla-foundation-incubator',
    'mantle-public-grants-scouts-program',
    'sui-overflow',
    'sui-defi-moonshots',
    'aaif-goose-grant-program',
    'nrf-singapore-fellowship',
    'avalanche-foundation-research-grants-up-to-50k-on-avalanche-',
    'google-chrome-web-framework-tools-performance-fund',
  ]) {
    assert.equal(ids.has(id), false, id);
  }
  assert.ok(board.some((row) => row.program_id === 'eurohpc-research-innovation-calls' && row.round.closes === '2026-09-30'));
  assert.ok(board.some((row) => row.program_id === 'arpa-h-open-funding-opportunities' && row.round.name.includes('FASTPASS')));
  assert.ok(!board.some((row) => row.round.name.startsWith('HEARING')));
});

test('apply url pass drops dead apply paths and closed audit intake', () => {
  const registry = loadRegistry();
  const board = liveBoard(registry, '2026-08-29');
  assert.ok(!board.some((row) => row.program_id === 'arbitrum-audit-program'));
  const youth = board.find((row) => row.program_id === 'responsible-technology-youth-power-fund-grants');
  assert.ok(youth);
  assert.equal(youth.apply_url, null);
  const lift = board.find((row) => row.program_id === 'linux-foundation-lift-scholarship');
  assert.ok(lift);
  assert.equal(lift.apply_url, null);
  const anth = board.find((row) => row.program_id === 'anthropic-economic-futures-initiative');
  assert.ok(anth);
  assert.equal(anth.apply_url, null);
  const blue = board.find((row) => row.program_id === 'bluedot-impact-rapid-grants-expanded-round');
  assert.ok(blue.apply_url.includes('/grants/rapid'));
});

test('standing remainder dates year-named calls and drops closed intakes', () => {
  const registry = loadRegistry();
  const board = liveBoard(registry, '2026-08-29');
  const ids = new Set(board.map((row) => row.program_id));
  assert.equal(ids.has('nsf-x-labs-1-5b-for-independent-milestone-based-research-tea'), false);
  assert.ok(!board.some((row) => row.program_id === 'freebsd-foundation-grants' && row.round.name.includes('EuroBSDCon')));
  assert.ok(!board.some((row) => row.round.name.includes('Release 4')));
  assert.ok(board.some((row) => row.program_id === 'nlnet-general-grants' && row.round.closes === '2026-11-03'));
  assert.ok(board.some((row) => row.program_id === 'outreachy' && row.round.closes === '2026-08-31'));
  assert.ok(board.some((row) => row.program_id === 'afwerx-sbir-sttr' && row.round.closes === '2026-09-23'));
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

test('homepage apply only flags the funder website itself', () => {
  assert.equal(isOrgHomepageApply('https://www.nsf.gov/', 'https://www.nsf.gov/'), true);
  assert.equal(
    isOrgHomepageApply(
      'https://www.nsf.gov/funding/opportunities/pesose-pathways-enable-secure-open-source-ecosystems/nsf26-506/solicitation',
      'https://www.nsf.gov/'
    ),
    false
  );
  assert.equal(isOrgHomepageApply('https://xgov.algorand.co/', 'https://algorand.co/'), false);
  assert.equal(isOrgHomepageApply('https://av20jp3z.paperform.co/', 'https://ev.org/'), false);
});

test('dated live calls have a real apply path and no duplicate Genesis row', () => {
  const registry = loadRegistry();
  const today = '2026-08-29';
  const briefing = briefingBoard({ registry, today });
  const genesis = briefing.dated.filter((row) => row.program_id === 'genesis-mission-foa-0003612');
  assert.equal(genesis.length, 1);
  assert.equal(genesis[0].round.closes, '2026-12-17');
  assert.ok(!briefing.dated.some((row) => row.program_id === 'ens-delegation-incentives-program'));

  const pesose = briefing.dated.find((row) => row.program_id === 'nsf-pesose');
  assert.ok(pesose);
  assert.match(pesose.apply_url, /pesose-pathways-enable-secure-open-source-ecosystems/);

  const jst = briefing.dated.find((row) => row.program_id === 'jst-sicorp-japan-canada-ai-agriculture');
  assert.ok(jst);
  assert.match(jst.apply_url, /announce_ca_ai2026/);

  const rocket = briefing.dated.find((row) => row.program_id === 'rocket-pool-gmc-grants');
  assert.ok(rocket);
  assert.equal(rocket.round.closes, '2026-09-07');

  const altProtein = briefing.dated.find((row) => row.program_id === 'coefficient-giving-alternative-protein-r-d-rfp');
  assert.ok(altProtein);
  assert.equal(altProtein.round.closes, '2026-09-15');

  const scf = briefing.dated.find((row) => row.program_id === 'stellar-community-fund-build-award');
  assert.ok(scf);
  assert.equal(scf.round.closes, '2026-11-08');

  assert.ok(!briefing.standingOpen.some((row) => row.program_id === 'mozilla-moss-foundational-technology'));
  assert.ok(!briefing.standingOpen.some((row) => row.program_id === 'base-ecosystem-fund'));
  assert.ok(briefing.standingOpen.some((row) => row.program_id === 'nsf-cise-future-computing-research-future-core'));

  for (const row of [...briefing.dated, ...briefing.standingOpen]) {
    assert.ok(row.apply_url, row.program_id);
    const org = registry.orgs.find((item) => item.id === row.org);
    assert.equal(isOrgHomepageApply(row.apply_url, org?.website), false, row.program_id);
  }
});

test('briefing board matches the live board and splits standing', () => {
  const registry = loadRegistry();
  const today = '2026-08-29';
  const board = liveBoard(registry, today);
  const briefing = briefingBoard({ registry, today });
  assert.equal(briefing.total, board.length);
  assert.equal(
    briefing.dated.length + briefing.standingOpen.length + briefing.standingAnnounced.length,
    board.length
  );
  assert.ok(briefing.dated.every((row) => !row.standing));
  assert.ok(briefing.standingOpen.every((row) => row.standing && row.round.status === 'open'));
  assert.ok(briefing.standingAnnounced.every((row) => row.standing && row.round.status !== 'open'));

  const crypto = briefingBoard({ registry, today, wire: 'crypto' });
  assert.ok(crypto.total <= briefing.total);
  assert.ok(
    [...crypto.dated, ...crypto.standingOpen, ...crypto.standingAnnounced].every((row) =>
      row.wires.includes('crypto')
    )
  );
});
