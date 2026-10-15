import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  assessWireProgram,
  confirmWireProgramPage,
  MAX_WIRE_PROGRAM_CHECKS,
  programNameCandidates,
  runWireProgramAutoApply,
  WIRE_PROGRAM_CHECKED_KEY,
  wireProgramAutoApplyLine,
} from '../src/lib/wire-program-auto-apply.ts';
import { fetchEvidencePage } from '../src/lib/curator-auto-apply.ts';
import { decideProposal } from '../src/lib/desk-decide.ts';
import { registryMayHaveChanged } from '../src/lib/committer.ts';
import { buildDeskLog } from '../src/lib/desk-log.ts';
import { runDailyIngestOnce } from '../src/lib/ingest.ts';
import {
  neverAutoReasonFor,
  WIRE_PROGRAM_AUTO_APPLY_POLICY,
  wireProgramAutoApplyEnabled,
} from '../src/lib/machine-approval-policy.ts';

const AT = new Date('2026-10-15T18:00:00Z');
const TODAY = '2026-10-15';
const ON = { WIRE_PROGRAM_AUTO_APPLY: '1' };

const ORG = { id: 'example-foundation', name: 'Example Foundation', aka: ['Example'], website: 'https://www.example.org', roles: ['funder'], wires: ['oss'], status: 'active', sources: [] };
const NO_SITE = { id: 'no-site', name: 'No Site Org', aka: [], roles: ['funder'], wires: ['oss'], status: 'active', sources: [] };
const EXISTING = { id: 'example-grants', name: 'Example Grants', org: ORG.id, apply_url: 'https://example.org/grants/', wires: ['oss'], status: 'active', rounds: [], sources: [] };

const URL_A = 'https://grants.example.org/builder-fund';
const PAGE_A = '<html><head><script>var x = "applications closed";</script></head><body><h1>Example Builder Fund</h1><p>Grants up to $10,000. Apply now.</p></body></html>';

/** The shape mapWireRow/decide queue for a resolved org and a new program name. */
function proposal({ id = 'p00001', name = 'Example Builder Fund', slug, org = ORG.id, orgName = ORG.name, url = URL_A, deadline = '2026-11-30', score = 85, created = '2026-10-15T10:00:00Z', extra = {} } = {}) {
  const programSlug = slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const payload = { id: programSlug, name, org, ...(deadline ? { apply_url: url, rounds: [{ name: 'Current call', status: 'open', closes: deadline, source: url }] } : {}) };
  return {
    id, type: 'new_program', org, org_name: orgName, program: name, title: `${orgName} · ${name}`, summary: 'From the wire.',
    evidence_url: url, proposed_change: { [`programs/${programSlug}.yaml`]: payload }, confidence: score,
    signal_id: `wire:${id}`, wire: 'oss', lane: 'judgment', state: 'pending', created_at: created,
    validation: { checks: [], reason: 'new programs require owner review', checked_at: created, never_auto: true },
    ...extra,
  };
}

const hash = (body) => createHash('sha256').update(Buffer.from(body)).digest('hex');

/** In-memory Desk with the real decideProposal on top. Approval appends the
 *  program to the fixture registry instead of writing files. */
function harness(rows, { pages = { [URL_A]: PAGE_A }, programs = [EXISTING], applyError = null, holdError = false } = {}) {
  const verdicts = [], applies = [], released = [], fetched = [], state = new Map();
  const registry = { orgs: [ORG, NO_SITE], programs: [...programs] };
  const deps = {
    getProposal: async (id) => rows.find((r) => r.id === id) ?? null,
    claimProposal: async (id) => { const r = rows.find((x) => x.id === id && x.state === 'pending'); if (!r) return null; r.state = 'applying'; return r; },
    releaseProposalClaim: async (id) => { const r = rows.find((x) => x.id === id); released.push(id); if (r?.state === 'applying') r.state = 'pending'; },
    recordVerdict: async (id, decision, opts) => {
      const r = rows.find((x) => x.id === id); r.state = decision;
      const { from: _from, ledgerRequired: _ledger, ...rest } = opts;
      const verdict = { proposal_id: id, decision, at: AT.toISOString(), ...rest };
      verdicts.unshift(verdict);
      return { proposal: r, verdict };
    },
    applyProposalDurably: async (p, message) => {
      applies.push({ id: p.id, message });
      if (holdError) { const e = new Error('registry write completed but handoff failed'); e.registryMayHaveChanged = true; throw e; }
      if (applyError) throw new Error(applyError);
      const [path, payload] = Object.entries(p.proposed_change)[0];
      registry.programs.push({ ...payload, rounds: payload.rounds ?? [] });
      return { changes: [{ path: `registry/${path}` }], notes: [], commit: null };
    },
    registryMayHaveChanged: (e) => Boolean(e?.registryMayHaveChanged) || registryMayHaveChanged(e),
  };
  // The real fetcher, with its DNS and fetch seams mocked.
  const fetchImpl = async (url) => {
    fetched.push(String(url));
    const body = pages[String(url)];
    if (body === undefined) return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const lookupImpl = async () => [{ address: '93.184.216.34' }];
  const run = (extra = {}) => runWireProgramAutoApply({
    env: ON,
    listPending: async () => rows.filter((r) => r.state === 'pending'),
    registry: () => registry,
    fetchPage: (url, domain) => fetchEvidencePage(url, domain, { fetchImpl, lookupImpl }),
    decide: (input) => decideProposal(input, deps),
    getState: async (key) => state.get(key) ?? null,
    setState: async (key, value) => { state.set(key, value); },
    now: () => AT,
    yieldTurn: async () => {},
    ...extra,
  });
  return { rows, verdicts, applies, released, fetched, state, registry, deps, run };
}

async function withFlag(value, fn) {
  const previous = process.env.WIRE_PROGRAM_AUTO_APPLY;
  if (value === undefined) delete process.env.WIRE_PROGRAM_AUTO_APPLY; else process.env.WIRE_PROGRAM_AUTO_APPLY = value;
  try { return await fn(); }
  finally { if (previous === undefined) delete process.env.WIRE_PROGRAM_AUTO_APPLY; else process.env.WIRE_PROGRAM_AUTO_APPLY = previous; }
}

const leftReasons = (summary, id) => summary.left.find((l) => l.proposal_id === id)?.reasons;

test('flag off: nothing is read, fetched or decided', async () => {
  assert.equal(wireProgramAutoApplyEnabled({}), false);
  assert.equal(wireProgramAutoApplyEnabled({ WIRE_PROGRAM_AUTO_APPLY: 'true' }), false);
  assert.equal(wireProgramAutoApplyEnabled(ON), true);
  // The validator still never approves a new program.
  assert.equal(neverAutoReasonFor('new_program'), 'new programs require owner review');
  let touched = false;
  const summary = await runWireProgramAutoApply({
    env: {},
    listPending: async () => { touched = true; return []; },
    fetchPage: async () => { touched = true; return { ok: false, reason: 'fetch_failed' }; },
    decide: async () => { touched = true; return { status: 500, body: {} }; },
  });
  assert.equal(summary, null);
  assert.equal(touched, false);

  // The daily run records nothing for the pass while the flag is off.
  await withFlag(undefined, async () => {
    const state = new Map();
    const out = await runDailyIngestOnce(AT, {
      getState: async (k) => state.get(k) ?? null,
      setState: async (k, v) => { state.set(k, v); },
      run: async () => ({ errors: [] }),
      sweep: async () => null,
    });
    assert.equal(out.executed, true);
    assert.equal('wire_program_auto_apply' in out.result, false);
  });

  // The decide boundary checks the flag too, even if the pass were wired by mistake.
  await withFlag(undefined, async () => {
    const h = harness([proposal()]);
    const result = await h.run();
    assert.equal(result.approved.length, 0);
    assert.deepEqual(leftReasons(result, 'p00001'), ['apply_failed: Wire program auto-apply covers pending Wire new programs only']);
    assert.equal(h.rows[0].state, 'pending');
    assert.equal(h.applies.length, 0);
  });
});

test('happy path: a verified Wire program is approved by the machine with its audit', async () => {
  await withFlag('1', async () => {
    const h = harness([proposal()]);
    const summary = await h.run();
    assert.equal(summary.candidates, 1);
    assert.equal(summary.checked, 1);
    assert.deepEqual(summary.approved, [{ proposal_id: 'p00001', program: 'Example Builder Fund', url: URL_A }]);
    assert.equal(summary.left_count, 0);
    assert.equal(h.rows[0].state, 'approved');
    assert.deepEqual(h.fetched, [URL_A]);

    const verdict = h.verdicts[0];
    assert.equal(verdict.by, 'machine');
    assert.match(verdict.note, /^auto: Wire program confirmed on example\.org/);
    assert.deepEqual(verdict.wire_program_auto_apply, {
      policy: WIRE_PROGRAM_AUTO_APPLY_POLICY,
      fetched_url: URL_A,
      final_url: URL_A,
      page_hash: hash(PAGE_A),
      matched_name: 'example builder fund',
      matched_signal: 'phrase: apply now',
      score: 85,
    });
    assert.match(h.applies[0].message, /Machine: Wire program auto-apply \(verified_wire_program_known_org_v1\)/);
    assert.match(h.applies[0].message, new RegExp(`sha256 ${hash(PAGE_A)}`));

    const [row] = buildDeskLog([{ id: 'p00001', title: h.rows[0].title }], h.verdicts);
    assert.equal(row.actor, 'machine · wire program auto-apply');
    assert.equal(row.autoApplied, true);
    assert.equal(row.revertable, false);
    assert.equal(row.programAudit.matchedName, 'example builder fund');
    assert.equal(row.programAudit.pageHash, hash(PAGE_A));
    assert.equal(h.state.get(WIRE_PROGRAM_CHECKED_KEY)['p00001'], undefined);
  });
});

test('a deadline written with its year is an open signal when no apply phrase is present', async () => {
  await withFlag('1', async () => {
    const page = '<h2>Example Builder Fund</h2><p>Deadline: November 30, 2026.</p>';
    const h = harness([proposal()], { pages: { [URL_A]: page } });
    const summary = await h.run();
    assert.equal(summary.approved.length, 1);
    assert.equal(h.verdicts[0].wire_program_auto_apply.matched_signal, 'deadline: 2026-11-30');
  });
});

test('each failing condition leaves the item pending with its reason', async () => {
  const cases = [
    ['unknown org', proposal({ org: 'not-in-registry', orgName: 'Ghost Org' }), ['unknown_org']],
    ['org without a website', proposal({ org: NO_SITE.id, orgName: NO_SITE.name, name: 'No Site Builder Fund' }), ['no_registered_website']],
    ['off-domain URL', proposal({ url: 'https://example.net/builder-fund' }), ['off_domain_url']],
    ['http URL', proposal({ url: 'http://example.org/builder-fund' }), ['off_domain_url']],
    ['bare homepage', proposal({ url: 'https://example.org/' }), ['homepage_url']],
    ['score below 70', proposal({ score: 68 }), ['low_score']],
    ['no score', proposal({ score: null }), ['no_score']],
    ['past deadline', proposal({ deadline: '2026-10-01' }), ['deadline_passed']],
    ['duplicate name', proposal({ name: 'Example Grants', slug: 'example-grants-2', url: 'https://example.org/grants-2' }), ['duplicate_name']],
    ['duplicate apply_url', proposal({ url: 'https://www.example.org/grants' }), ['duplicate_url']],
    ['duplicate id', proposal({ slug: 'example-grants' }), ['duplicate_id']],
    ['generic name', proposal({ name: 'Grants Program' }), ['name_not_specific']],
    ['curator flagged', proposal({ extra: { curator_review: { verdict: 'reject', reason: 'dupe', sources: [], key_id: 'k', key_name: 'K', at: TODAY } } }), ['curator_flagged']],
    ['org merge in the change', proposal({ extra: { proposed_change: { 'programs/x.yaml': { name: 'X Fund' }, 'orgs/y.yaml': { name: 'Y' } } } }), ['unexpected_shape']],
  ];
  await withFlag('1', async () => {
    for (const [label, item, reasons] of cases) {
      const h = harness([item]);
      const summary = await h.run();
      assert.equal(summary.approved.length, 0, label);
      assert.deepEqual(leftReasons(summary, item.id), reasons, label);
      assert.equal(h.rows[0].state, 'pending', label);
      assert.equal(h.applies.length, 0, label);
      assert.equal(h.fetched.length, 0, `${label}: no fetch before the cheap checks pass`);
    }
  });
});

test('page checks: fetch failure, missing name, no signal and a closed page stay pending', async () => {
  const cases = [
    ['fetch fails', {}, ['fetch_failed']],
    ['name missing', { [URL_A]: '<h1>Something else entirely</h1><p>Apply now.</p>' }, ['name_not_on_page']],
    ['name words scattered', { [URL_A]: '<p>Example docs. Builder notes. Fund updates. Apply now.</p>' }, ['name_not_on_page']],
    ['no open signal', { [URL_A]: '<h1>Example Builder Fund</h1><p>Read about past grantees.</p>' }, ['no_open_signal']],
    ['closed page', { [URL_A]: '<h1>Example Builder Fund</h1><p>Applications are now closed. How to apply next year.</p>' }, ['page_says_closed']],
    ['wrong-year deadline only', { [URL_A]: '<h1>Example Builder Fund</h1><p>Deadline: November 30, 2025.</p>' }, ['no_open_signal']],
  ];
  await withFlag('1', async () => {
    for (const [label, pages, reasons] of cases) {
      const h = harness([proposal()], { pages });
      const summary = await h.run();
      assert.equal(summary.approved.length, 0, label);
      assert.deepEqual(leftReasons(summary, 'p00001'), reasons, label);
      assert.equal(h.rows[0].state, 'pending', label);
      assert.equal(h.applies.length, 0, label);
      assert.equal(summary.checked, 1, label);
    }
  });
});

test('an off-domain redirect is refused by the fetcher', async () => {
  await withFlag('1', async () => {
    const h = harness([proposal()]);
    const summary = await h.run({
      fetchPage: (url, domain) => fetchEvidencePage(url, domain, {
        fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/builder-fund' } }),
        lookupImpl: async () => [{ address: '93.184.216.34' }],
      }),
    });
    assert.deepEqual(leftReasons(summary, 'p00001'), ['fetch_failed']);
    assert.equal(h.rows[0].state, 'pending');
  });
});

test('staged validation failure in decideProposal leaves the item pending and releases the claim', async () => {
  await withFlag('1', async () => {
    const h = harness([proposal()], { applyError: 'staged registry validation failed: programs/example-builder-fund.yaml: bad' });
    const summary = await h.run();
    assert.equal(summary.approved.length, 0);
    assert.match(leftReasons(summary, 'p00001')[0], /^apply_failed: staged registry validation failed/);
    assert.equal(h.rows[0].state, 'pending');
    assert.deepEqual(h.released, ['p00001']);
  });
});

test('a reconciliation hold stops the run', async () => {
  await withFlag('1', async () => {
    const rows = [proposal(), proposal({ id: 'p00002', name: 'Example Research Fund', url: 'https://example.org/research-fund' })];
    const h = harness(rows, {
      holdError: true,
      pages: { [URL_A]: PAGE_A, 'https://example.org/research-fund': '<h1>Example Research Fund</h1> apply now' },
    });
    const summary = await h.run();
    assert.equal(summary.halted, 'halted_after_reconciliation_hold');
    assert.equal(h.applies.length, 1);
    assert.equal(summary.left.length, 2);
  });
});

test('cap: at most 15 pages per run, then the least recently checked go first', async () => {
  await withFlag('1', async () => {
    const rows = [], pages = {};
    for (let i = 1; i <= 20; i++) {
      const name = `Example Track ${String.fromCharCode(64 + i)}${String.fromCharCode(64 + i)}${String.fromCharCode(64 + i)} Fund`;
      const url = `https://example.org/track-${i}`;
      rows.push(proposal({ id: `p${String(i).padStart(5, '0')}`, name, url, created: `2026-10-${String(i).padStart(2, '0')}T00:00:00Z` }));
      pages[url] = `<h1>${name}</h1>`; // no open signal: every one stays pending
    }
    const h = harness(rows, { pages });
    assert.equal(MAX_WIRE_PROGRAM_CHECKS, 15);
    const first = await h.run();
    assert.equal(first.candidates, 20);
    assert.equal(first.checked, 15);
    assert.equal(h.fetched.length, 15);
    assert.equal(first.left.filter((l) => l.reasons[0] === 'check_cap').length, 5);
    // Newest first among never-checked items.
    assert.equal(h.fetched[0], 'https://example.org/track-20');

    const capped = first.left.filter((l) => l.reasons[0] === 'check_cap').map((l) => l.proposal_id).sort();
    h.fetched.length = 0;
    const second = await h.run();
    assert.equal(second.checked, 15);
    const fetchedIds = h.fetched.slice(0, 5).map((u) => `p${u.split('-').pop().padStart(5, '0')}`).sort();
    assert.deepEqual(fetchedIds, capped);

    // A smaller cap is honoured too, and approvals never exceed it.
    const h2 = harness(rows.map((r) => ({ ...r, state: 'pending' })), { pages: Object.fromEntries(Object.entries(pages).map(([u, b]) => [u, `${b} apply now`])) });
    const third = await h2.run({ maxChecks: 3 });
    assert.equal(third.approved.length, 3);
    assert.equal(h2.fetched.length, 3);
  });
});

test('a backlog item already pending on the Desk is evaluated by the daily run', async () => {
  await withFlag('1', async () => {
    const backlog = proposal({ id: 'p00042', created: '2026-10-10T09:00:00Z' });
    const h = harness([backlog]);
    const state = new Map();
    const out = await runDailyIngestOnce(AT, {
      getState: async (k) => state.get(k) ?? null,
      setState: async (k, v) => { state.set(k, v); },
      run: async () => ({ proposals_created: 0, errors: [] }), // nothing new today
      sweep: async () => null,
      wirePrograms: () => h.run(),
    });
    assert.equal(out.executed, true);
    assert.equal(out.result.wire_program_auto_apply.approved[0].proposal_id, 'p00042');
    assert.equal(h.rows[0].state, 'approved');
    assert.equal(state.get('daily_ingest_claim:2026-10-15').status, 'completed');
  });
});

test('the pass is fail-soft inside the daily run', async () => {
  const state = new Map();
  let swept = false;
  const out = await runDailyIngestOnce(AT, {
    getState: async (k) => state.get(k) ?? null,
    setState: async (k, v) => { state.set(k, v); },
    run: async () => ({ errors: [] }),
    sweep: async () => { swept = true; return null; },
    wirePrograms: async () => { throw new Error('desk store offline'); },
  });
  assert.equal(out.executed, true);
  assert.equal(out.result.wire_program_auto_apply.error, 'desk store offline');
  assert.equal(swept, true);
  assert.equal(state.get('daily_ingest_claim:2026-10-15').status, 'completed');
});

test('decideProposal accepts the audit only from the machine, for a pending Wire new program', async () => {
  const audit = { policy: WIRE_PROGRAM_AUTO_APPLY_POLICY, fetched_url: URL_A, final_url: URL_A, page_hash: 'x', matched_name: 'n', matched_signal: 's', score: 90 };
  await withFlag('1', async () => {
    const owner = harness([proposal()]);
    const r1 = await decideProposal({ id: 'p00001', decision: 'approved', by: 'owner', wire_program_auto_apply: audit }, owner.deps);
    assert.equal(r1.status, 403);
    const discuss = harness([proposal({ extra: { signal_id: 'discuss:9' } })]);
    const r2 = await decideProposal({ id: 'p00001', decision: 'approved', by: 'machine', wire_program_auto_apply: audit }, discuss.deps);
    assert.equal(r2.status, 403);
    const org = harness([{ ...proposal(), type: 'new_org' }]);
    const r3 = await decideProposal({ id: 'p00001', decision: 'approved', by: 'machine', wire_program_auto_apply: audit }, org.deps);
    assert.equal(r3.status, 403);
    for (const h of [owner, discuss, org]) assert.equal(h.applies.length, 0);
  });
});

test('name matching: full name, title core, org-stripped core; generic phrases never count', () => {
  assert.deepEqual(
    programNameCandidates({ name: 'Example Builder Fund', title: 'Example Foundation · Example Builder Fund', orgNames: ['Example Foundation', 'Example'] }),
    ['example builder fund', 'builder fund']
  );
  assert.deepEqual(
    programNameCandidates({ name: 'Example Foundation Grants Program', title: 'Example Foundation · Example Foundation Grants Program', orgNames: ['Example Foundation', 'Example'] }),
    ['example foundation grants program']
  );
  assert.deepEqual(programNameCandidates({ name: 'Grants', title: null, orgNames: [] }), []);
  assert.deepEqual(programNameCandidates({ name: 'Señal Café Grants', title: null, orgNames: [] }), ['senal cafe grants']);

  const plan = assessWireProgram(proposal(), { orgs: [ORG], programs: [], today: TODAY });
  assert.equal(plan.ok, true);
  const ok = (body) => confirmWireProgramPage(plan.plan, { ok: true, body, hash: 'h', url: URL_A });
  assert.equal(ok('<p>EXAMPLE — Builder-Fund: apply now</p>').ok, true);
  assert.equal(ok('<p>The Builder Fund is open; apply now</p>').matched_name, 'builder fund');
  assert.equal(ok('<p>example builder funding: apply now</p>').ok, false);
  assert.equal(ok('<script>Example Builder Fund apply now</script>').ok, false);
});

test('health line', () => {
  assert.equal(wireProgramAutoApplyLine(undefined), null);
  assert.deepEqual(wireProgramAutoApplyLine({ at: 'x', error: 'boom' }), { text: 'Wire programs: auto-apply failed (boom)', failed: true });
  const line = wireProgramAutoApplyLine({
    candidates: 5, checked: 3, approved: [{ proposal_id: 'p1' }], left_count: 4,
    left: [{ proposal_id: 'p2', reasons: ['low_score'] }, { proposal_id: 'p3', reasons: ['name_not_on_page', 'page_says_closed'] }],
  });
  assert.equal(line.failed, false);
  assert.equal(line.text, 'Wire programs: auto-apply on, 1 approved, 4 left for owner (5 pending, 3 pages checked): p2: low_score; p3: name_not_on_page, page_says_closed; …');
});
