import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

import {
  MAX_REVIEW_RECHECKS,
  onlyReviewDatesChanged,
  previewProgramWrite,
  renewedReview,
  REVIEW_RENEW_DAYS,
  reviewIntakeSupport,
  reviewRecheckLine,
  reviewSourceDomain,
  runReviewRecheck,
} from '../src/lib/review-recheck.ts';
import { decideProposal, proposalChangeHash } from '../src/lib/desk-decide.ts';
import { buildProposalChanges } from '../src/lib/committer.ts';
import { buildDeskLog } from '../src/lib/desk-log.ts';
import { runDailyIngestOnce } from '../src/lib/ingest.ts';
import { isReviewRenewalChange, REVIEW_RECHECK_POLICY, reviewRecheckEnabled } from '../src/lib/machine-approval-policy.ts';
import { reviewFreshness, reviewRenewalBlocker } from '../src/lib/program-review.ts';

const NOW = new Date('2026-10-15T18:00:00Z');
const TODAY = '2026-10-15';
const ON = { DESK_UPKEEP_ENABLED: '1', REVIEW_RECHECK_ENABLED: '1' };
const ORG = { id: 'example-foundation', name: 'Example Foundation', aka: [], website: 'https://www.example.org', roles: ['funder'], wires: ['oss'], status: 'active', sources: [] };
const SOURCE = 'https://example.org/grants/builder-fund';

function program(id, { name = 'Builder Fund', source = SOURCE, review = {}, status = 'active', rounds = [], apply_url } = {}) {
  return {
    id, name, org: ORG.id, parent: null, systems: [], wires: ['oss'], status,
    ...(apply_url ? { apply_url } : {}),
    summary: 'A fund for open source builders with sufficiently descriptive public text.',
    rounds,
    review: {
      checked_on: '2026-09-26', review_after: '2026-10-03', operating: status, intake: 'open',
      intake_note: 'Applications are open on the official page.', source, kind: 'program', relationship: 'current',
      questions: [], history: [], ...review,
    },
    sources: [source],
  };
}

const OPEN_PAGE = '<html><body><h1>Builder Fund</h1><p>Applications are open. Apply now.</p></body></html>';
const CLOSED_PAGE = '<html><body><h1>Builder Fund</h1><p>Applications are closed for this year.</p></body></html>';
const hashOf = (text) => createHash('sha256').update(text).digest('hex');

function harness(programs, { pages = {}, existing = [], env = ON, decideStatus = 200, ...over } = {}) {
  const files = new Map(programs.map((p) => [p.id, YAML.stringify(p)]));
  const fetched = [];
  const queued = [];
  const decisions = [];
  let pauses = 0;
  const deps = {
    env,
    registry: () => ({ orgs: [ORG], programs }),
    readProgram: (id) => files.get(id) ?? null,
    listAll: async () => existing,
    queue: async (raw) => {
      const proposal = { ...raw, id: `p${queued.length + 1}`, lane: 'judgment', state: 'pending', created_at: NOW.toISOString() };
      queued.push(proposal);
      return proposal;
    },
    fetchPage: async (url, domain) => {
      fetched.push({ url, domain });
      const body = pages[url];
      if (body === undefined) return { ok: false, reason: 'fetch_failed' };
      return { ok: true, body, hash: hashOf(body), url };
    },
    // What the committer would write: the file with the proposed review.
    preview: (proposal, id) => ({ ...YAML.parse(files.get(id)), review: proposal.proposed_change[`programs/${id}.yaml`].review }),
    decide: async (input) => {
      decisions.push(input);
      return decideStatus === 200 ? { status: 200, body: { ok: true } } : { status: decideStatus, body: { error: 'changed_since_check' } };
    },
    now: () => NOW,
    yieldTurn: async () => { pauses += 1; },
    ...over,
  };
  return { deps, files, fetched, queued, decisions, pauses: () => pauses };
}

function withEnv(values, fn) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  return Promise.resolve().then(fn).finally(restore);
}

test('the recheck is off unless both DESK_UPKEEP_ENABLED=1 and REVIEW_RECHECK_ENABLED=1', async () => {
  assert.equal(reviewRecheckEnabled({}), false);
  assert.equal(reviewRecheckEnabled({ REVIEW_RECHECK_ENABLED: '1' }), false);
  assert.equal(reviewRecheckEnabled({ DESK_UPKEEP_ENABLED: '1' }), false);
  assert.equal(reviewRecheckEnabled({ DESK_UPKEEP_ENABLED: '1', REVIEW_RECHECK_ENABLED: 'true' }), false);
  assert.equal(reviewRecheckEnabled(ON), true);
  for (const env of [{}, { REVIEW_RECHECK_ENABLED: '1' }, { DESK_UPKEEP_ENABLED: '1' }]) {
    let touched = false;
    const h = harness([program('builder-fund')], { env, pages: { [SOURCE]: OPEN_PAGE } });
    h.deps.registry = () => { touched = true; return { orgs: [ORG], programs: [] }; };
    assert.equal(await runReviewRecheck(h.deps), null);
    assert.equal(touched, false);
    assert.equal(h.fetched.length + h.queued.length + h.decisions.length, 0);
  }
});

test('the daily run records nothing for the recheck while it is off, and records its failure when it throws', async () => {
  const state = new Map();
  const base = {
    getState: async (key) => state.get(key) ?? null,
    setState: async (key, value) => { state.set(key, value); },
    run: async () => ({ errors: [] }),
    sweep: async () => null,
    wirePrograms: async () => null,
    upkeep: async () => null,
  };
  await withEnv({ DESK_UPKEEP_ENABLED: undefined, REVIEW_RECHECK_ENABLED: undefined }, async () => {
    const out = await runDailyIngestOnce(NOW, base);
    assert.equal(out.executed, true);
    assert.equal('review_recheck' in out.result, false);
  });
  state.clear();
  const order = [];
  const out = await runDailyIngestOnce(NOW, {
    ...base,
    upkeep: async () => { order.push('upkeep'); return null; },
    recheck: async () => { order.push('recheck'); throw new Error('boom'); },
  });
  assert.deepEqual(order, ['upkeep', 'recheck']);
  assert.equal(out.result.review_recheck.error, 'boom');
});

test('a page that still names the program and says open renews the dates as a machine decision with audit and change hash', async () => {
  const p = program('builder-fund');
  const h = harness([p], { pages: { [SOURCE]: OPEN_PAGE } });
  const summary = await runReviewRecheck(h.deps);
  assert.equal(summary.renewed.length, 1);
  assert.equal(summary.queued.length, 0);
  assert.deepEqual(h.fetched, [{ url: SOURCE, domain: 'example.org' }]);
  const [proposal] = h.queued;
  assert.equal(proposal.type, 'profile_note');
  assert.match(proposal.signal_id, /^recheck:builder-fund:2026-10-03:renewal:2026-10-15$/);
  assert.equal(isReviewRenewalChange(proposal.proposed_change), true);
  const fileHash = hashOf(h.files.get('builder-fund'));
  assert.deepEqual(proposal.proposed_change._expected_content_hashes, { 'programs/builder-fund.yaml': fileHash });
  const review = proposal.proposed_change['programs/builder-fund.yaml'].review;
  assert.deepEqual(review, { ...p.review, checked_on: TODAY, review_after: '2026-11-14' });
  const [input] = h.decisions;
  assert.equal(input.id, proposal.id);
  assert.equal(input.decision, 'approved');
  assert.equal(input.by, 'machine');
  assert.match(input.note, /^auto: review renewed/);
  assert.equal(input.expect_change_hash, proposalChangeHash(proposal.proposed_change));
  assert.deepEqual(input.review_recheck_auto_apply, {
    policy: REVIEW_RECHECK_POLICY,
    program_id: 'builder-fund',
    fetched_url: SOURCE,
    final_url: SOURCE,
    page_hash: hashOf(OPEN_PAGE),
    matched_name: 'builder fund',
    matched_intake: 'open: applications are open',
    previous_checked_on: '2026-09-26',
    previous_review_after: '2026-10-03',
    checked_on: TODAY,
    review_after: '2026-11-14',
  });
  assert.equal(summary.renewed[0].review_after, '2026-11-14');
  assert.equal(REVIEW_RENEW_DAYS, 30);
});

test('a closed review is renewed by a page that still says closed', async () => {
  const p = program('builder-fund', { review: { intake: 'closed', intake_note: 'Closed between calls.' } });
  const h = harness([p], { pages: { [SOURCE]: CLOSED_PAGE } });
  const summary = await runReviewRecheck(h.deps);
  assert.equal(summary.renewed.length, 1);
  assert.equal(h.decisions[0].review_recheck_auto_apply.matched_intake, 'closed: applications are closed');
});

test('a page that now says closed queues a closure and applies nothing', async () => {
  const h = harness([program('builder-fund')], { pages: { [SOURCE]: CLOSED_PAGE } });
  const summary = await runReviewRecheck(h.deps);
  assert.equal(h.decisions.length, 0);
  assert.equal(summary.renewed.length, 0);
  assert.equal(summary.queued.length, 1);
  assert.equal(summary.queued[0].kind, 'closure');
  const [proposal] = h.queued;
  assert.match(proposal.title, /closed/);
  assert.match(proposal.signal_id, /:closure:/);
  const review = proposal.proposed_change['programs/builder-fund.yaml'].review;
  assert.equal(review.intake, 'closed');
  assert.match(review.intake_note, /applications are closed/);
});

test('an intake the page does not confirm, or a missing name, is queued and not applied', async () => {
  const both = '<h1>Builder Fund</h1><p>Apply now. Applications are closed.</p>';
  const nameless = '<h1>Our grants</h1><p>Applications are open.</p>';
  const h = harness([program('a-fund', { source: 'https://example.org/a' }), program('b-fund', { source: 'https://example.org/b' })], {
    pages: { 'https://example.org/a': both, 'https://example.org/b': nameless },
  });
  const summary = await runReviewRecheck(h.deps);
  assert.equal(h.decisions.length, 0);
  assert.deepEqual(summary.queued.map((q) => q.kind).sort(), ['intake_not_confirmed', 'name_missing']);
});

test('a failed fetch stamps nothing and queues nothing', async () => {
  const h = harness([program('builder-fund')], { pages: {} });
  const summary = await runReviewRecheck(h.deps);
  assert.equal(summary.fetched, 1);
  assert.deepEqual(summary.failed, [{ program_id: 'builder-fund', reason: 'fetch_failed' }]);
  assert.equal(h.queued.length, 0);
  assert.equal(h.decisions.length, 0);
  const thrown = harness([program('builder-fund')], { fetchPage: async () => { throw new Error('dns'); } });
  const again = await runReviewRecheck(thrown.deps);
  assert.equal(again.failed.length, 1);
  assert.equal(thrown.queued.length + thrown.decisions.length, 0);
});

test('off-domain and shared-host sources, and off-domain answers, are refused and queued', async () => {
  assert.deepEqual(reviewSourceDomain('https://grants.example.org/x', {}, ORG), { domain: 'example.org' });
  assert.deepEqual(reviewSourceDomain('https://apply.fund.io/x', { apply_url: 'https://apply.fund.io/form' }, ORG), { domain: 'apply.fund.io' });
  assert.deepEqual(reviewSourceDomain('https://other.org/x', {}, ORG), { refused: 'off_domain' });
  assert.deepEqual(reviewSourceDomain('https://github.com/example/fund', { apply_url: 'https://github.com/example/apply' }, ORG), { refused: 'shared_host' });
  assert.deepEqual(reviewSourceDomain('https://docs.google.com/document/d/1', {}, ORG), { refused: 'shared_host' });
  assert.deepEqual(reviewSourceDomain('http://example.org/x', {}, ORG), { refused: 'off_domain' });

  const programs = [
    program('off-fund', { name: 'Off Fund', source: 'https://other.org/fund' }),
    program('gh-fund', { name: 'GH Fund', source: 'https://github.com/example/fund' }),
    program('moved-fund', { name: 'Moved Fund', source: 'https://example.org/moved' }),
  ];
  const h = harness(programs, {
    fetchPage: async () => ({ ok: true, body: '<h1>Moved Fund</h1><p>Applications are open.</p>', hash: 'h', url: 'https://elsewhere.net/moved' }),
  });
  const summary = await runReviewRecheck(h.deps);
  assert.equal(h.decisions.length, 0);
  assert.deepEqual(Object.fromEntries(summary.queued.map((q) => [q.program_id, q.kind])), {
    'off-fund': 'off_domain', 'gh-fund': 'shared_host', 'moved-fund': 'off_domain',
  });
  assert.equal(summary.fetched, 1);
});

test('programs beyond a recheck, drifted, already queued or owner-rejected are skipped with their reason', async () => {
  const programs = [
    program('unresolved', { review: { kind: 'unresolved', relationship: 'unconfirmed', relationship_note: 'n', intake: 'unknown' }, status: 'unknown' }),
    program('former', { review: { relationship: 'former', relationship_note: 'n', intake: 'postponed' } }),
    program('unconfirmed', { review: { relationship: 'unconfirmed', relationship_note: 'n' } }),
    program('paused', { status: 'paused', review: { intake: 'closed' } }),
    { ...program('drifted'), status: 'active', review: { ...program('drifted').review, operating: 'paused' } },
    program('queued-one'),
    program('rejected-one'),
    program('expired-by-machine', { source: 'https://example.org/m' }),
    { ...program('current'), review: { ...program('current').review, review_after: '2026-12-01' } },
  ];
  const existing = [
    { id: 'q1', state: 'pending', signal_id: 'recheck:queued-one:2026-10-03:closure:2026-10-14' },
    { id: 'q2', state: 'rejected', decision_note: 'No, still open.', signal_id: 'recheck:rejected-one:2026-10-03:closure:2026-10-14' },
    { id: 'q3', state: 'rejected', decision_note: 'auto: stale (pending 30+ days)', signal_id: 'recheck:expired-by-machine:2026-10-03:name_missing:2026-09-01' },
  ];
  const h = harness(programs, { existing, pages: { 'https://example.org/m': OPEN_PAGE } });
  const summary = await runReviewRecheck(h.deps);
  assert.deepEqual(Object.fromEntries(summary.skipped.map((s) => [s.program_id, s.reason])), {
    unresolved: 'unresolved_identity',
    former: 'former_operator',
    unconfirmed: 'unconfirmed_operator',
    paused: 'program_not_active',
    drifted: 'status_drift',
    'queued-one': 'already_queued',
    'rejected-one': 'owner_rejected',
  });
  assert.equal(summary.due, 8);
  assert.deepEqual(h.fetched.map((f) => f.url), ['https://example.org/m']);
  assert.equal(summary.renewed.length, 1);
  // The same "beyond a recheck" rule /admin/health shows.
  const renewable = Object.fromEntries(reviewFreshness(programs, TODAY).expired.map((r) => [r.id, r.renewable]));
  for (const id of ['unresolved', 'former', 'unconfirmed', 'paused']) assert.equal(renewable[id], false, id);
});

test('the run fetches at most MAX_REVIEW_RECHECKS pages, one at a time', async () => {
  assert.equal(MAX_REVIEW_RECHECKS, 30);
  const programs = Array.from({ length: 35 }, (_, i) => program(`fund-${String(i).padStart(2, '0')}`, { source: `https://example.org/f${i}` }));
  let inFlight = 0, maxInFlight = 0;
  const h = harness(programs, {
    fetchPage: async () => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return { ok: false, reason: 'fetch_failed' };
    },
  });
  const summary = await runReviewRecheck(h.deps);
  assert.equal(summary.fetched, 30);
  assert.equal(summary.failed.length, 30);
  assert.equal(summary.skipped.filter((s) => s.reason === 'over_cap').length, 5);
  assert.equal(maxInFlight, 1);
  assert.ok(h.pauses() >= 34);
});

test('an open review scoped to a round needs that round live and its deadline on the page', async () => {
  const rounds = [{ name: 'First call', status: 'open', closes: '2026-11-03', source: SOURCE }];
  const scoped = (id, extra = {}) => program(id, { source: `https://example.org/${id}`, rounds, review: { round_names: ['First call'], ...extra } });
  const past = { ...scoped('past'), rounds: [{ ...rounds[0], closes: '2026-10-01' }] };
  const h = harness([scoped('dated'), scoped('undated'), past], {
    pages: {
      'https://example.org/dated': `${OPEN_PAGE}<p>Deadline: November 3, 2026.</p>`,
      'https://example.org/undated': OPEN_PAGE,
      'https://example.org/past': `${OPEN_PAGE}<p>Deadline: October 1, 2026.</p>`,
    },
  });
  const summary = await runReviewRecheck(h.deps);
  assert.deepEqual(summary.renewed.map((r) => r.program_id), ['dated']);
  assert.deepEqual(Object.fromEntries(summary.queued.map((q) => [q.program_id, q.kind])), { undated: 'deadline_not_on_page', past: 'round_not_current' });
});

test('a refused automatic approval stays on the Desk and is reported', async () => {
  const h = harness([program('builder-fund')], { pages: { [SOURCE]: OPEN_PAGE }, decideStatus: 409 });
  const summary = await runReviewRecheck(h.deps);
  assert.equal(summary.renewed.length, 0);
  assert.deepEqual(summary.queued.map((q) => [q.kind, q.reason]), [['apply_failed', 'changed_since_check']]);
});

test('intake support is conservative', () => {
  const open = { intake: 'open' };
  assert.deepEqual(reviewIntakeSupport('<p>Apply now</p>', open), { state: 'supports', phrase: 'apply now' });
  assert.deepEqual(reviewIntakeSupport('<p>How to apply</p>', open), { state: 'unclear' });
  assert.deepEqual(reviewIntakeSupport('<p>Apply now. No longer accepting applications.</p>', open), { state: 'unclear' });
  assert.deepEqual(reviewIntakeSupport('<script>"apply now"</script><p>Deadline has passed</p>', open), { state: 'contradicts', intake: 'closed', phrase: 'deadline has passed' });
  assert.deepEqual(reviewIntakeSupport('<p>Reviewed on a rolling basis</p>', open), { state: 'unclear' });
  assert.deepEqual(reviewIntakeSupport('<p>Reviewed on a rolling basis</p>', { intake: 'open', intake_mode: 'rolling' }), { state: 'supports', phrase: 'rolling basis' });
  assert.deepEqual(reviewIntakeSupport('<p>Applications are closed</p>', { intake: 'closed' }), { state: 'supports', phrase: 'applications are closed' });
  assert.deepEqual(reviewIntakeSupport('<p>Applications are closed. Apply here for updates.</p>', { intake: 'closed' }), { state: 'unclear' });
  assert.deepEqual(reviewIntakeSupport('<p>Apply now</p>', { intake: 'unknown' }), { state: 'contradicts', intake: 'open', phrase: 'apply now' });
  assert.deepEqual(reviewIntakeSupport('<p>Nothing here</p>', { intake: 'postponed' }), { state: 'unclear' });
});

test('a renewal the committer would widen is queued, not applied', async () => {
  const h = harness([program('builder-fund')], { pages: { [SOURCE]: OPEN_PAGE } });
  h.deps.preview = (proposal, id) => ({ ...YAML.parse(h.files.get(id)), review: proposal.proposed_change[`programs/${id}.yaml`].review, apply_url: undefined, sources: [] });
  const summary = await runReviewRecheck(h.deps);
  assert.equal(h.decisions.length, 0);
  assert.deepEqual(summary.queued.map((q) => q.kind), ['wider_change']);
});

test('a renewal touches only the review dates, on every reviewed program in the registry', () => {
  let checked = 0, renewable = 0;
  for (const file of readdirSync('registry/programs')) {
    const text = readFileSync(`registry/programs/${file}`, 'utf8');
    const doc = YAML.parse(text);
    if (!doc.review) continue;
    const id = file.replace(/\.yaml$/, '');
    const path = `programs/${id}.yaml`;
    const review = renewedReview(doc.review, TODAY);
    const proposal = {
      id: 'p-renew', type: 'profile_note', org: doc.org, program: doc.name, title: 't', summary: 's',
      evidence_url: doc.review.source, lane: 'judgment', state: 'pending', created_at: NOW.toISOString(), signal_id: `recheck:${id}:x`,
      proposed_change: { [path]: { review }, _expected_content_hashes: { [path]: hashOf(text) } },
    };
    assert.equal(isReviewRenewalChange(proposal.proposed_change), true);
    const yaml = buildProposalChanges(proposal).changes.filter((c) => c.path.endsWith('.yaml'));
    assert.deepEqual(yaml.map((c) => c.path), [`registry/${path}`]);
    const after = previewProgramWrite(proposal, id);
    assert.equal(after.review.checked_on, TODAY);
    assert.equal(after.review.review_after, '2026-11-14');
    // Every program a recheck may renew comes back with only its dates moved.
    // The one that does not (an empty apply_url the committer drops) is
    // beyond a recheck, and the dry-run guard would queue it regardless.
    if (onlyReviewDatesChanged(doc, after)) checked += 1;
    else assert.notEqual(reviewRenewalBlocker(doc), null, id);
    if (reviewRenewalBlocker(doc) === null) renewable += 1;
  }
  assert.ok(checked > 0 && renewable > 0);
  assert.equal(onlyReviewDatesChanged({ review: { a: 1, checked_on: 'x' } }, { review: { a: 2, checked_on: 'y' } }), false);
  assert.equal(onlyReviewDatesChanged({ review: { a: 1 }, sources: ['a'] }, { review: { a: 1 }, sources: ['a', 'b'] }), false);
});

test('decideProposal only takes a review audit for a pending recheck renewal, with its hash, while the flags are on', async () => {
  const change = { 'programs/x.yaml': { review: { checked_on: TODAY } }, _expected_content_hashes: { 'programs/x.yaml': 'a'.repeat(64) } };
  const audit = { policy: REVIEW_RECHECK_POLICY, program_id: 'x', fetched_url: 'u', final_url: 'u', page_hash: 'h', matched_name: 'x', matched_intake: 'open: apply now', previous_checked_on: 'a', previous_review_after: 'b', checked_on: 'c', review_after: 'd' };
  const store = (proposedChange = change, extra = {}) => {
    const row = { id: 'p1', type: 'profile_note', org: 'o', title: 't', summary: 's', lane: 'judgment', state: 'pending', created_at: NOW.toISOString(), signal_id: 'recheck:x:2026-10-03:renewal:2026-10-15', proposed_change: proposedChange, ...extra };
    const applied = [];
    const deps = {
      getProposal: async () => row,
      claimProposal: async () => { row.state = 'applying'; return row; },
      releaseProposalClaim: async () => { row.state = 'pending'; },
      recordVerdict: async (id, decision, opts) => { row.state = decision; return { proposal: { ...row }, verdict: { proposal_id: id, decision, at: 'now', ...opts } }; },
      applyProposalDurably: async (p) => { applied.push(p.id); return { notes: [], changes: [], commit: null }; },
      registryMayHaveChanged: () => false,
    };
    return { row, applied, deps };
  };
  const input = (extra = {}) => ({ id: 'p1', decision: 'approved', by: 'machine', review_recheck_auto_apply: audit, expect_change_hash: proposalChangeHash(change), ...extra });
  await withEnv({ DESK_UPKEEP_ENABLED: undefined, REVIEW_RECHECK_ENABLED: undefined }, async () => {
    assert.equal((await decideProposal(input(), store().deps)).status, 403);
  });
  await withEnv(ON, async () => {
    const noHash = store();
    assert.equal((await decideProposal(input({ expect_change_hash: undefined }), noHash.deps)).body.error, 'change_hash_required');
    const wider = { 'programs/x.yaml': { review: {}, status: 'paused' }, _expected_content_hashes: change._expected_content_hashes };
    assert.equal((await decideProposal(input({ expect_change_hash: proposalChangeHash(wider) }), store(wider).deps)).status, 403);
    assert.equal((await decideProposal(input(), store(change, { signal_id: 'wire:1' }).deps)).status, 403);
    assert.equal((await decideProposal(input({ by: 'curator' }), store().deps)).status, 403);
    const ok = store();
    const result = await decideProposal(input(), ok.deps);
    assert.equal(result.status, 200);
    assert.deepEqual(ok.applied, ['p1']);
    assert.deepEqual(result.body.verdict.review_recheck_auto_apply, audit);
    const log = buildDeskLog([{ id: 'p1', title: 't' }], [result.body.verdict]);
    assert.equal(log[0].actor, 'machine · review renewal');
    assert.equal(log[0].autoApplied, true);
  });
});

test('the health line names renewed, queued, failed and skipped with reasons', () => {
  assert.equal(reviewRecheckLine(null), null);
  assert.deepEqual(reviewRecheckLine({ at: 'x', error: 'boom' }), { text: 'Review recheck: failed (boom)', failed: true });
  const line = reviewRecheckLine({
    due: 11, fetched: 6,
    renewed: [{ program_id: 'a' }, { program_id: 'b' }],
    queued: [{ program_id: 'c', kind: 'closure' }, { program_id: 'd', kind: 'shared_host' }],
    failed: [{ program_id: 'e', reason: 'fetch_failed' }],
    skipped: [{ program_id: 'f', reason: 'unresolved_identity' }, { program_id: 'g', reason: 'unresolved_identity' }, { program_id: 'h', reason: 'former_operator' }],
    errors: [],
  });
  assert.equal(line.failed, false);
  assert.equal(line.text, 'Review recheck: 2 renewed, 2 queued for owner (closure 1, shared_host 1), 1 fetch failed (e), 3 skipped (unresolved_identity 2, former_operator 1) (11 due, 6 pages fetched)');
});
