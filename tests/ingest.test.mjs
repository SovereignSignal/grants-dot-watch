import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIngestOrgIndex,
  decide,
  fetchDiscussItems,
  isoDateOnly,
  mapDiscussItem,
  mapWireRow,
  nextDiscussWatermark,
  normalizeConfidence,
  openDiscussWindow,
  parseDiscussItem,
  pickRoundName,
  runDailyIngestOnce,
} from '../src/lib/ingest.ts';

const ORG = {
  id: 'example-foundation',
  name: 'Example Foundation',
  aka: [],
  systems: [],
  wires: ['oss'],
  roles: ['funder'],
  website: 'https://example.org',
  status: 'active',
  profile: 'Example funder.',
  sources: ['https://example.org'],
};

const PROGRAM = {
  id: 'example-grants',
  name: 'Example Grants',
  org: ORG.id,
  systems: [],
  wires: ['oss'],
  status: 'active',
  summary: 'Example program.',
  rounds: [],
  sources: ['https://example.org/grants'],
};

function context(orgs = [ORG], programs = []) {
  return { index: buildIngestOrgIndex(orgs), programs };
}

function emptyIngestResult() {
  return {
    source_counts: {
      wire: { fetched: 0, error: null, policy_filtered: 0, policy_reasons: {} },
      discuss: { fetched: 0, error: null, incomplete: false, quarantined: 0, policy_filtered: 0, policy_reasons: {} },
    },
    proposals_created: 0,
    deduped: 0,
    dropped: 0,
    validation: { passed: 0, failed: 0 },
    watermarks: { wire_scan_entries: null, discuss_grants: null },
    errors: [],
  };
}

test('ISO deadline parsing rejects impossible calendar dates and loose suffixes', () => {
  assert.equal(isoDateOnly('2028-02-29'), '2028-02-29');
  assert.equal(isoDateOnly('2028-02-29T23:59:59Z'), '2028-02-29');
  assert.equal(isoDateOnly('2026-02-29'), null);
  assert.equal(isoDateOnly('2026-04-31'), null);
  assert.equal(isoDateOnly('2026-00-01'), null);
  assert.equal(isoDateOnly('2026-13-01'), null);
  assert.equal(isoDateOnly('2026-01-00'), null);
  assert.equal(isoDateOnly('2026-01-01 anything'), null);
  assert.equal(isoDateOnly('2026-01-01Tnot-a-time'), null);
});

test('a fixed deadline on a program with no rounds becomes Current call', () => {
  assert.equal(pickRoundName([]), 'Current call');
  assert.equal(pickRoundName([{ name: 'Round 7', status: 'open' }]), 'Round 7');
  assert.equal(
    pickRoundName([
      { name: 'Round 6', status: 'closed' },
      { name: 'Round 7', status: 'open' },
    ]),
    null
  );

  const outcome = decide({
    org: ORG,
    orgNameCandidate: ORG.name,
    orgWebsiteGuess: ORG.website,
    programApplyUrl: null,
    programNameCandidate: PROGRAM.name,
    deadline: '2026-10-15',
    amount: null,
    evidenceUrl: 'https://example.org/grants/current',
    wire: 'oss',
    confidence: undefined,
    signalId: 'test:fixed-date',
    summary: 'A dated call.',
    programs: [PROGRAM],
  });

  const change = outcome.candidate.proposed_change['programs/example-grants.yaml'];
  assert.deepEqual(change.rounds, [
    {
      name: 'Current call',
      closes: '2026-10-15',
      source: 'https://example.org/grants/current',
    },
  ]);
});

test('an existing-program signal without a deadline does not fabricate a fact', () => {
  const outcome = decide({
    org: ORG,
    orgNameCandidate: ORG.name,
    orgWebsiteGuess: ORG.website,
    programApplyUrl: 'https://example.org/grants',
    programNameCandidate: PROGRAM.name,
    deadline: null,
    amount: '$100,000',
    evidenceUrl: 'https://example.org/news',
    wire: 'oss',
    confidence: 90,
    signalId: 'test:no-deadline',
    summary: 'General program news.',
    programs: [PROGRAM],
  });

  assert.equal(outcome.candidate, null);
  assert.equal(outcome.dropped, true);
});

test('confidence remains unknown when absent and rejects out-of-range values', () => {
  assert.equal(normalizeConfidence(undefined), undefined);
  assert.equal(normalizeConfidence(null), undefined);
  assert.equal(normalizeConfidence(-1), undefined);
  assert.equal(normalizeConfidence(101), undefined);
  assert.equal(normalizeConfidence(Number.NaN), undefined);
  assert.equal(normalizeConfidence('88'), undefined);
  assert.equal(normalizeConfidence(0), 0);
  assert.equal(normalizeConfidence(88), 88);
  assert.equal(normalizeConfidence(100), 100);

  const ctx = context();
  const outcome = mapDiscussItem(
    {
      id: 41,
      title: 'New Example Fund',
      program: 'New Example Fund',
      url: 'https://forum.example.net/topic/41',
      applyUrl: 'https://example.org/apply',
      wire: 'oss',
      classification: 'GRANT',
      kind: 'program_launch',
      status: 'open',
    },
    ctx
  );
  assert.equal(outcome.candidate.confidence, undefined);
});

test('malformed discuss.watch records are isolated per item', () => {
  const firstSeenAt = '2026-07-21T12:00:00Z';
  assert.match(parseDiscussItem({ id: 1, url: 'https://forum.example/topic', title: 42, firstSeenAt }).reason, /title/);
  assert.match(parseDiscussItem({ id: 1, url: 'https://forum.example/topic', confidence: 101, firstSeenAt }).reason, /between 0 and 100/);
  assert.match(parseDiscussItem({ id: 1, url: '/relative', firstSeenAt }).reason, /absolute http/);
  assert.match(parseDiscussItem({ id: 1, url: 'https://forum.example/topic', applyUrl: '/apply', firstSeenAt }).reason, /applyUrl/);
  assert.match(parseDiscussItem({ id: 1, url: 'https://forum.example/topic', deadline: '2026-02-29', firstSeenAt }).reason, /real ISO/);
  assert.match(parseDiscussItem({ id: 1, url: 'https://forum.example/topic', firstSeenAt: 'yesterday' }).reason, /valid timestamp/);
  assert.match(parseDiscussItem({ id: 1, url: 'https://forum.example/topic' }).reason, /firstSeenAt|topicCreatedAt/);
  assert.equal(
    parseDiscussItem({ id: 1, url: 'https://forum.example/topic', title: 'Valid', confidence: null, firstSeenAt }).item.title,
    'Valid'
  );
});

test('canonical org name beats a colliding domain', () => {
  const alpha = {
    ...ORG,
    id: 'alpha-foundation',
    name: 'Alpha Foundation',
    website: 'https://shared.example',
  };
  const beta = {
    ...ORG,
    id: 'beta-foundation',
    name: 'Beta Foundation',
    website: 'https://shared.example',
  };

  const outcome = mapDiscussItem(
    {
      id: 45,
      title: 'Alpha Builder Fund',
      program: 'Alpha Builder Fund',
      protocol: 'Alpha Foundation',
      url: 'https://forum.example/topic/45',
      applyUrl: 'https://shared.example/apply',
      wire: 'oss',
      classification: 'GRANT',
      kind: 'program_launch',
      status: 'open',
    },
    context([alpha, beta])
  );

  assert.equal(outcome.candidate.org, alpha.id);
  assert.equal(outcome.candidate.type, 'new_program');
});

test('a shared-domain-only collision is dropped instead of creating or selecting an org', () => {
  const alpha = {
    ...ORG,
    id: 'alpha-foundation',
    name: 'Alpha Foundation',
    website: 'https://shared.example',
  };
  const beta = {
    ...ORG,
    id: 'beta-foundation',
    name: 'Beta Foundation',
    website: 'https://shared.example',
  };

  const outcome = mapDiscussItem(
    {
      id: 46,
      title: 'Gamma Builder Fund',
      program: 'Gamma Builder Fund',
      protocol: 'Gamma Foundation',
      url: 'https://forum.example/topic/46',
      applyUrl: 'https://shared.example/apply',
      wire: 'oss',
      classification: 'GRANT',
      kind: 'program_launch',
      status: 'open',
    },
    context([alpha, beta])
  );

  assert.equal(outcome.candidate, null);
  assert.equal(outcome.dropped, true);
  assert.match(outcome.dropReason, /ambiguous org identity \(domain collision\)/);
});

test('program matching accepts one exact result and drops ambiguous loose matches', () => {
  const programs = [
    {
      ...PROGRAM,
      id: 'climate-grants',
      name: 'Climate Grants',
    },
    {
      ...PROGRAM,
      id: 'climate-grants-accelerator',
      name: 'Climate Grants Accelerator',
    },
  ];
  const ctx = context([ORG], programs);

  const exact = mapDiscussItem(
    {
      id: 47,
      title: 'Climate Grants',
      program: 'Climate Grants',
      protocol: ORG.name,
      url: 'https://forum.example/topic/47',
      deadline: '2026-10-15',
      wire: 'oss',
      classification: 'GRANT',
      kind: 'program_launch',
      status: 'open',
    },
    ctx
  );
  assert.equal(exact.candidate.type, 'deadline_change');
  assert.ok(exact.candidate.proposed_change['programs/climate-grants.yaml']);

  const ambiguous = mapDiscussItem(
    {
      id: 48,
      title: 'Climate',
      program: 'Climate',
      protocol: ORG.name,
      url: 'https://forum.example/topic/48',
      deadline: '2026-10-15',
      wire: 'oss',
      classification: 'GRANT',
      kind: 'program_launch',
      status: 'open',
    },
    ctx
  );
  assert.equal(ambiguous.candidate, null);
  assert.equal(ambiguous.dropped, true);
  assert.match(ambiguous.dropReason, /ambiguous program identity/);
});

test('applicant and closed signals are policy-filtered before proposal mapping', () => {
  const emptyCtx = context([], []);
  const application = mapDiscussItem(
    {
      id: 50,
      url: 'https://forum.example/topic/50',
      title: 'Grant application from a prospective recipient',
      protocol: 'Example DAO',
      kind: 'application',
      status: 'open',
    },
    emptyCtx
  );
  assert.equal(application.candidate, null);
  assert.match(application.dropReason, /applicant signal/);

  const closed = mapDiscussItem(
    {
      id: 51,
      url: 'https://forum.example/topic/51',
      title: 'Historical grant round',
      protocol: 'Example DAO',
      classification: 'GRANT',
      kind: 'program_launch',
      status: 'closed',
    },
    emptyCtx
  );
  assert.equal(closed.candidate, null);
  assert.match(closed.dropReason, /non-current status/);

  const wireApplicant = mapWireRow(
    {
      id: 52,
      name: 'Applicant proposal',
      description: null,
      source_url: 'https://example.org/proposal',
      amount: null,
      deadline: null,
      deadline_iso: null,
      wire: 'oss',
      status: 'approved',
      quality_score: 90,
      enriched_summary: null,
      classification: 'applicant_observation',
      org_id: null,
      tags: [],
      created_at: '2026-07-21T00:00:00.000000Z',
      source_published_at: null,
      org_name: null,
      org_website: null,
      org_aliases: null,
    },
    emptyCtx
  );
  assert.equal(wireApplicant.candidate, null);
  assert.match(wireApplicant.dropReason, /applicant signal/);
});

function grantWireRow(patch = {}) {
  return {
    id: 80,
    name: 'Example Open Grants',
    description: 'Applications are open for independent research.',
    source_url: 'https://example.org/grants/open',
    amount: null,
    deadline: null,
    deadline_iso: null,
    wire: 'oss',
    status: 'approved',
    quality_score: 80,
    enriched_summary: 'A funder-run grant program is accepting applications.',
    classification: 'GRANT',
    org_id: 1,
    tags: [],
    created_at: '2026-10-04T00:00:00.000000Z',
    source_published_at: null,
    org_name: 'Example Foundation',
    org_website: 'https://example.org',
    org_aliases: null,
    wire_area: 3,
    operator_route: 'publish',
    ...patch,
  };
}

test('an open GRANT program is accepted from the wire and from discuss.watch', () => {
  const ctx = context([ORG], []);
  const wire = mapWireRow(grantWireRow(), ctx);
  assert.equal(wire.dropped, false);
  assert.equal(wire.candidate.type, 'new_program');
  assert.equal(wire.candidate.org, ORG.id);

  const asText = mapWireRow(grantWireRow({ id: 81, wire_area: '3' }), ctx);
  assert.equal(asText.candidate.type, 'new_program');

  const discuss = mapDiscussItem(
    {
      id: 82,
      title: 'Example Open Grants',
      program: 'Example Open Grants',
      protocol: ORG.name,
      url: 'https://forum.example/topic/82',
      wire: 'oss',
      classification: 'GRANT',
      kind: 'rfp',
      status: 'open',
    },
    ctx
  );
  assert.equal(discuss.dropped, false);
  assert.equal(discuss.candidate.type, 'new_program');
  assert.equal(discuss.candidate.org, ORG.id);
});

test('wire_area missing or null still accepts a GRANT', () => {
  const ctx = context([ORG], []);
  const omitted = mapWireRow(grantWireRow({ id: 83, wire_area: undefined }), ctx);
  assert.equal(omitted.candidate.type, 'new_program');
  const absent = mapWireRow(grantWireRow({ id: 84, wire_area: null }), ctx);
  assert.equal(absent.candidate.type, 'new_program');
});

test('NEWS, awards, hackathons, fellowships, and wire area 2 are rejected', () => {
  const ctx = context([ORG], []);
  const cases = [
    [grantWireRow({ id: 90, classification: 'NEWS' }), /classification news/],
    [grantWireRow({ id: 91, classification: 'AWARD', name: 'Round award slate' }), /classification award/],
    [grantWireRow({ id: 92, name: 'Cohort awarded', enriched_summary: 'The funder awarded the cohort.' }), /reject token \(awarded\)/],
    [grantWireRow({ id: 93, name: 'Rapid Agent Hackathon' }), /reject token \(hackathon\)/],
    [grantWireRow({ id: 94, enriched_summary: 'This is a research fellowship, not a grant call.' }), /reject token \(fellowship\)/],
    [grantWireRow({ id: 95, wire_area: 2 }), /wire_area 2/],
    [grantWireRow({ id: 96, wire_area: '2' }), /wire_area 2/],
    [grantWireRow({ id: 97, classification: 'GRANT', operator_route: 'relationship_signal' }), /relationship signal/],
    [grantWireRow({ id: 101, name: 'Agent Buildathon' }), /reject token \(buildathon\)/],
    [grantWireRow({ id: 102, name: 'Community prize' }), /reject token \(prize\)/],
    [grantWireRow({ id: 103, name: 'Studio residency' }), /reject token \(residency\)/],
    [grantWireRow({ id: 104, name: 'Round results' }), /reject token \(results\)/],
    [grantWireRow({ id: 105, name: 'Grant recipients' }), /reject token \(recipients\)/],
  ];
  for (const [row, reason] of cases) {
    const outcome = mapWireRow(row, ctx);
    assert.equal(outcome.candidate, null);
    assert.equal(outcome.dropped, true);
    assert.match(outcome.dropReason, reason);
  }
});

test('discuss.watch never ingests ROLE and requires an open-program kind', () => {
  const ctx = context([ORG], []);
  const role = mapDiscussItem(
    {
      id: 98,
      title: 'Council steward seat',
      program: 'Council steward seat',
      protocol: ORG.name,
      url: 'https://forum.example/topic/98',
      wire: 'oss',
      classification: 'ROLE',
      kind: 'program_launch',
      status: 'open',
    },
    ctx
  );
  assert.equal(role.candidate, null);
  assert.match(role.dropReason, /role signal \(ROLE\)/);

  const roleKind = mapDiscussItem(
    {
      id: 99,
      title: 'Paid council seat',
      protocol: ORG.name,
      url: 'https://forum.example/topic/99',
      classification: 'GRANT',
      kind: 'council_seat',
      status: 'open',
    },
    ctx
  );
  assert.equal(roleKind.candidate, null);
  assert.match(roleKind.dropReason, /role signal \(council_seat\)/);

  const report = mapDiscussItem(
    {
      id: 100,
      title: 'Milestone report',
      protocol: ORG.name,
      url: 'https://forum.example/topic/100',
      classification: 'GRANT',
      kind: 'milestone_report',
      status: 'open',
    },
    ctx
  );
  assert.equal(report.candidate, null);
  assert.match(report.dropReason, /not an open program \(milestone_report\)/);

  const news = mapDiscussItem(
    {
      id: 106,
      title: 'Funder blog update',
      protocol: ORG.name,
      url: 'https://forum.example/topic/106',
      classification: 'NEWS',
      kind: 'program_launch',
      status: 'open',
    },
    ctx
  );
  assert.equal(news.candidate, null);
  assert.match(news.dropReason, /classification news/);
});

test('a capped discuss.watch window persists its cursor and advances only after exhaustion', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    const cursor = url.searchParams.get('cursor');
    if (cursor === null) {
      return Response.json({
        items: [
          {
            id: 32,
            url: 'https://forum.example/topic/32',
            title: 'Applicant submission',
            kind: 'application',
            status: 'closed',
            firstSeenAt: '2026-07-20T13:00:00Z',
          },
          {
            id: 31,
            url: 'https://forum.example/topic/31',
            title: 31,
            firstSeenAt: '2026-07-20T12:00:00Z',
          },
          {
            id: 30,
            url: 'https://forum.example/topic/30',
            title: 'Valid grant',
            classification: 'GRANT',
            kind: 'program_launch',
            status: 'open',
            firstSeenAt: '2026-07-20T11:00:00Z',
          },
        ],
        meta: { nextCursor: 20 },
      });
    }
    assert.equal(cursor, '20');
    return Response.json({
      items: [
        {
          id: 20,
          url: 'https://forum.example/topic/20',
          title: 'Older valid grant',
          classification: 'GRANT',
          kind: 'program_launch',
          status: 'open',
          firstSeenAt: '2026-07-15T08:00:00Z',
        },
      ],
      meta: { nextCursor: null },
    });
  };

  const initial = { since: '2026-07-01T00:00:00.000Z', last_id: 10 };
  const firstWindow = openDiscussWindow(initial, false);
  const first = await fetchDiscussItems({
    backfill: false,
    since: firstWindow.since,
    cursor: firstWindow.cursor,
    maxPages: 1,
  });

  assert.equal(first.error, null);
  assert.equal(first.exhausted, false);
  assert.equal(first.nextCursor, 20);
  assert.equal(first.items.length, 1);
  assert.equal(first.quarantinedCount, 1);
  assert.equal(first.policyFilteredCount, 1);
  assert.deepEqual(first.policyReasons, { 'applicant signal (application)': 1 });
  assert.deepEqual(first.maxSeen, { since: '2026-07-20T13:00:00.000Z', last_id: 32 });
  assert.equal(nextDiscussWatermark(initial, firstWindow, { ...first, error: 'second page failed' }), null);

  const pending = nextDiscussWatermark(initial, firstWindow, first);
  assert.equal(pending.since, initial.since);
  assert.equal(pending.last_id, initial.last_id);
  assert.equal(pending.pending.next_cursor, 20);
  assert.equal(pending.pending.since, initial.since);

  const secondWindow = openDiscussWindow(pending, false);
  const second = await fetchDiscussItems({
    backfill: secondWindow.mode === 'backfill',
    since: secondWindow.since,
    cursor: secondWindow.cursor,
    maxPages: 1,
  });
  assert.equal(second.exhausted, true);
  assert.equal(requests[1].searchParams.get('since'), initial.since);
  assert.equal(requests[1].searchParams.get('cursor'), '20');

  const completed = nextDiscussWatermark(pending, secondWindow, second);
  assert.deepEqual(completed, { since: '2026-07-20T13:00:00.000Z', last_id: 32 });
});

test('daily ingest claims one run per Pacific calendar day across sequential replicas', async () => {
  const state = new Map();
  let runs = 0;
  const result = {
    source_counts: {
      wire: { fetched: 0, error: null, policy_filtered: 0, policy_reasons: {} },
      discuss: { fetched: 0, error: null, incomplete: false, quarantined: 0, policy_filtered: 0, policy_reasons: {} },
    },
    proposals_created: 0,
    deduped: 0,
    dropped: 0,
    validation: { passed: 0, failed: 0 },
    watermarks: { wire_scan_entries: null, discuss_grants: null },
    errors: [],
  };
  const deps = {
    getState: async (key) => state.get(key) ?? null,
    setState: async (key, value) => state.set(key, value),
    run: async () => {
      runs++;
      return result;
    },
  };

  const first = await runDailyIngestOnce(new Date('2026-07-22T00:30:00Z'), deps);
  const sequentialReplica = await runDailyIngestOnce(new Date('2026-07-22T00:31:00Z'), deps);
  assert.equal(first.day, '2026-07-21');
  assert.equal(first.executed, true);
  assert.equal(sequentialReplica.executed, false);
  assert.equal(runs, 1);
  assert.equal(state.get('daily_ingest_claim:2026-07-21').status, 'completed');

  const nextProductDay = await runDailyIngestOnce(new Date('2026-07-22T07:30:00Z'), deps);
  assert.equal(nextProductDay.day, '2026-07-22');
  assert.equal(nextProductDay.executed, true);
  assert.equal(runs, 2);
});

test('a failed daily ingest claim can be retried', async () => {
  const state = new Map();
  let attempts = 0;
  const deps = {
    getState: async (key) => state.get(key) ?? null,
    setState: async (key, value) => state.set(key, value),
    run: async () => {
      attempts++;
      if (attempts === 1) throw new Error('source unavailable');
      return {
        source_counts: {
          wire: { fetched: 0, error: null, policy_filtered: 0, policy_reasons: {} },
          discuss: { fetched: 0, error: null, incomplete: false, quarantined: 0, policy_filtered: 0, policy_reasons: {} },
        },
        proposals_created: 0,
        deduped: 0,
        dropped: 0,
        validation: { passed: 0, failed: 0 },
        watermarks: { wire_scan_entries: null, discuss_grants: null },
        errors: [],
      };
    },
  };

  await assert.rejects(runDailyIngestOnce(new Date('2026-07-22T00:30:00Z'), deps), /source unavailable/);
  assert.equal(state.get('daily_ingest_claim:2026-07-21').status, 'failed');
  const retry = await runDailyIngestOnce(new Date('2026-07-22T00:35:00Z'), deps);
  assert.equal(retry.executed, true);
  assert.equal(attempts, 2);
});

test('a stale daily ingest claim is a recoverable lease', async () => {
  const state = new Map([
    [
      'daily_ingest_claim:2026-07-21',
      { day: '2026-07-21', status: 'claimed', claimed_at: '2026-07-21T15:00:00.000Z' },
    ],
  ]);
  let runs = 0;
  const result = await runDailyIngestOnce(new Date('2026-07-21T20:00:00.000Z'), {
    getState: async (key) => state.get(key) ?? null,
    setState: async (key, value) => state.set(key, value),
    run: async () => {
      runs++;
      return emptyIngestResult();
    },
  });
  assert.equal(result.executed, true);
  assert.equal(runs, 1);
});
