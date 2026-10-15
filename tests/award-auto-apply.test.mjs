import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readBaseline } from '../src/lib/funding-store.mjs';
import { buildFundingDeskChanges, readControlledFunding } from '../src/lib/funding-desk-core.mjs';
import { captureFundingTable } from '../src/lib/funding-source-html.mjs';
import { sweepAwardSources } from '../src/lib/funding-source-sweep.mjs';
import { packetReasons, mappingReasons } from '../src/lib/funding-source-clean.mjs';
import { previewFundingPack } from '../src/lib/funding-desk-service.mjs';
import { createAwardAutoApply, MAX_AWARD_AUTO_APPLIES } from '../src/lib/award-auto-apply.ts';
import { decideProposal } from '../src/lib/desk-decide.ts';
import { registryMayHaveChanged } from '../src/lib/committer.ts';
import { applyLedgerRow } from '../src/lib/boot-replay.ts';
import { buildDeskLog } from '../src/lib/desk-log.ts';
import { neverAutoReasonFor, awardSourcesAutoApplyEnabled } from '../src/lib/machine-approval-policy.ts';

const AT = new Date('2026-10-15T18:00:00Z'), NEXT_DAY = new Date('2026-10-16T18:00:00Z'), TODAY = '2026-10-15';
const NF_URL = 'https://numfocus.org/programs/small-development-grants';
const RS_URL = 'https://royalsociety.org/grants/research-grants/';
const nfRow = (name, title, amount, year, round) => `<tr><td>${name}</td><td>${title}</td><td>${amount}</td><td>${year}</td><td>${round}</td></tr>`;
const nfPage = rows => '<h2>Previously Funded Programs</h2><table><tr><th>Project</th><th>Proposal Title</th><th>Amount</th><th>Year</th><th>Round</th></tr>' + rows.join('') + '</table>';
const NF = nfPage([nfRow('Alpha', 'Alpha docs', '$1,000.00', '2024', '1'), nfRow('Beta', 'Beta tests', '$2,500.00', '2024', '2')]);
const RS = '<p>Application and offer data does not include upgraded reserves.</p><table><tr><th>Financial year</th><th>Eligible applications</th><th>Offers</th><th>Success rate</th></tr><tr><td>2024/25</td><td>400</td><td>100</td><td>25.0%</td></tr></table>';

function fixture(pages = { [NF_URL]: NF, [RS_URL]: RS }) {
  const dir = mkdtempSync(join(tmpdir(), 'award-auto-')), root = join(dir, 'registry');
  mkdirSync(join(root, 'orgs'), { recursive: true }); mkdirSync(join(root, 'programs'));
  const docs = [
    ['orgs', { id: 'numfocus', name: 'NumFOCUS', sources: ['https://numfocus.org'] }],
    ['orgs', { id: 'royal-society', name: 'Royal Society', sources: ['https://royalsociety.org'] }],
    ['programs', { id: 'numfocus-small-development-grants', org: 'numfocus', name: 'Small Development Grants', wires: ['oss'], rounds: [] }],
    ['programs', { id: 'royal-society-research-grants', org: 'royal-society', name: 'Research Grants', wires: ['science'], rounds: [] }],
  ];
  for (const [sub, doc] of docs) writeFileSync(join(root, sub, `${doc.id}.yaml`), JSON.stringify(doc));
  const load = () => ({ root, baseline: readBaseline(root, JSON.parse), dataset: readControlledFunding(root).dataset });
  const capture = async source => captureFundingTable(source, {
    now: () => AT,
    request: async url => {
      if (!pages[url]) throw new Error('offline');
      return new Response(pages[url], { headers: { 'content-type': 'text/html' } });
    },
  });
  return { dir, root, load, capture, pages, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

/** In-memory Desk: the store half of decideProposal, with the real decide logic
 *  on top. Approval writes through the real funding change builder and the boot
 *  replay writer into the fixture registry, never the repo's own registry. */
function desk(f) {
  const rows = [], verdicts = [], applies = [];
  let next = 1;
  const deps = {
    getProposal: async id => rows.find(r => r.id === id) ?? null,
    claimProposal: async id => { const r = rows.find(x => x.id === id && x.state === 'pending'); if (!r) return null; r.state = 'applying'; return r; },
    releaseProposalClaim: async id => { const r = rows.find(x => x.id === id); if (r?.state === 'applying') r.state = 'pending'; },
    recordVerdict: async (id, decision, opts) => {
      const r = rows.find(x => x.id === id); r.state = decision;
      const verdict = { proposal_id: id, decision, note: opts.note, at: new Date().toISOString(), commit: opts.commit ?? null, ...(opts.by ? { by: opts.by } : {}), ...(opts.award_auto_apply ? { award_auto_apply: opts.award_auto_apply } : {}) };
      verdicts.unshift(verdict);
      return { proposal: r, verdict };
    },
    applyProposalDurably: async (p, message) => {
      const { baseline } = f.load();
      const result = buildFundingDeskChanges(f.root, baseline, p, TODAY);
      applyLedgerRow(f.dir, result.changes.map(c => {
        const path = join(f.dir, c.path), before = existsSync(path) ? readFileSync(path, 'utf8') : null;
        return { path: c.path, content_before_hash: before === null ? null : createHash('sha256').update(before).digest('hex'), content_after: c.content };
      }));
      applies.push({ id: p.id, message });
      return { ...result, commit: null };
    },
    registryMayHaveChanged,
  };
  return {
    rows, verdicts, applies, deps,
    proposals: async () => rows,
    enqueue: async candidates => {
      const inserted = candidates.filter(c => !rows.some(r => r.signal_id === c.signal_id))
        .map(c => ({ ...c, id: `p${String(next++).padStart(5, '0')}`, lane: 'judgment', state: 'pending', created_at: AT.toISOString() }));
      rows.push(...inserted);
      return { inserted, skipped: candidates.length - inserted.length };
    },
    decide: input => decideProposal(input, deps),
  };
}

const sweepDeps = (f, d, extra = {}) => ({
  enabled: true, fundingDeskEnabled: true, capture: f.capture, load: f.load, proposals: d.proposals, enqueue: d.enqueue,
  sources: ['numfocus-sdg', 'royal-society-research'], now: () => AT, ...extra,
});
const hook = (f, d, extra = {}) => createAwardAutoApply({ load: f.load, decide: d.decide, writerBusy: () => false, now: () => AT, ...extra });

async function withFlag(value, fn) {
  const previous = process.env.AWARD_SOURCES_AUTO_APPLY;
  if (value === undefined) delete process.env.AWARD_SOURCES_AUTO_APPLY; else process.env.AWARD_SOURCES_AUTO_APPLY = value;
  try { return await fn(); }
  finally { if (previous === undefined) delete process.env.AWARD_SOURCES_AUTO_APPLY; else process.env.AWARD_SOURCES_AUTO_APPLY = previous; }
}

test('flag off: the sweep queues only, and decide refuses a machine funding approval', async () => {
  assert.equal(awardSourcesAutoApplyEnabled({}), false);
  assert.equal(awardSourcesAutoApplyEnabled({ AWARD_SOURCES_AUTO_APPLY: 'true' }), false);
  assert.equal(awardSourcesAutoApplyEnabled({ AWARD_SOURCES_AUTO_APPLY: '1' }), true);
  // The validator's policy is unchanged: it never approves award creation.
  assert.equal(neverAutoReasonFor('new_award'), 'award creation requires owner review');
  assert.equal(neverAutoReasonFor('profile_note'), 'profile and identity changes require owner review');
  await withFlag(undefined, async () => {
    const f = fixture(), d = desk(f);
    try {
      const plain = await sweepAwardSources(sweepDeps(f, d));
      assert.equal(plain.approval, false);
      assert.equal(plain.auto_applied, 0);
      assert.equal(plain.packets_queued, 2);
      assert.ok(d.rows.every(r => r.state === 'pending'));
      // Even if a hook were wired by mistake, the decide boundary checks the flag.
      const f2 = fixture(), d2 = desk(f2);
      try {
        const summary = await sweepAwardSources(sweepDeps(f2, d2, { autoApply: hook(f2, d2) }));
        assert.equal(summary.auto_applied, 0);
        assert.equal(summary.left_for_owner.length, 2);
        for (const left of summary.left_for_owner) assert.deepEqual(left.reasons, ['apply_failed: Funding imports require owner review']);
        assert.ok(d2.rows.every(r => r.state === 'pending'));
        assert.equal(d2.applies.length, 0);
        assert.equal(existsSync(join(f2.root, 'funding-events')), false);
      } finally { f2.clean(); }
    } finally { f.clean(); }
  });
});

test('clean packets are approved through decideProposal as a machine decision', async () => {
  await withFlag('1', async () => {
    const f = fixture(), d = desk(f);
    try {
      const summary = await sweepAwardSources(sweepDeps(f, d, { autoApply: hook(f, d) }));
      assert.equal(summary.approval, true);
      assert.equal(summary.packets_queued, 2, JSON.stringify(summary));
      assert.equal(summary.auto_applied, 2, JSON.stringify(summary.left_for_owner));
      assert.deepEqual(summary.left_for_owner, []);
      assert.ok(d.rows.every(r => r.state === 'approved'));
      assert.equal(d.applies.length, 2);
      for (const verdict of d.verdicts) {
        assert.equal(verdict.by, 'machine');
        assert.equal(verdict.award_auto_apply.policy, 'clean_first_party_award_packet_v1');
        assert.match(verdict.note, /^auto: clean first-party award packet from /);
        const row = d.rows.find(r => r.id === verdict.proposal_id);
        assert.equal(row.signal_id, `funding-v2:${verdict.award_auto_apply.plan_digest}`);
      }
      assert.match(d.applies[0].message, /Machine: award-source auto-apply \(clean_first_party_award_packet_v1\)/);
      const log = buildDeskLog(d.rows, d.verdicts);
      for (const row of log) {
        assert.equal(row.actor, 'machine · award auto-apply');
        assert.equal(row.autoApplied, true);
        assert.equal(row.revertable, false);
        assert.ok(row.awardAudit.planDigest);
      }
      const { dataset } = readControlledFunding(f.root);
      assert.equal(dataset['funding-events'].length, 2);
      assert.equal(dataset['process-metrics'].length, 1);
      // Tomorrow the same sources compile to nothing new.
      const again = await sweepAwardSources(sweepDeps(f, d, { now: () => NEXT_DAY, autoApply: hook(f, d) }));
      assert.equal(again.packets_queued, 0);
      assert.equal(again.auto_applied, 0);
    } finally { f.clean(); }
  });
});

test('held records block only the packets they touch', async () => {
  await withFlag('1', async () => {
    // An unrelated joint row is held; Alpha's packet still auto-applies.
    const f = fixture({ [NF_URL]: nfPage([nfRow('Alpha', 'Alpha docs', '$1,000.00', '2024', '1'), nfRow('Gamma & Delta', 'Joint work', '$500.00', '2024', '1')]) }), d = desk(f);
    try {
      const summary = await sweepAwardSources(sweepDeps(f, d, { sources: ['numfocus-sdg'], autoApply: hook(f, d) }));
      assert.equal(summary.records_held, 1);
      assert.equal(summary.auto_applied, 1, JSON.stringify(summary.left_for_owner));
      assert.equal(d.rows[0].state, 'approved');
    } finally { f.clean(); }
    // A held joint row naming Alpha keeps Alpha's packet on the Desk.
    const g = fixture({ [NF_URL]: nfPage([nfRow('Alpha', 'Alpha docs', '$1,000.00', '2024', '1'), nfRow('Alpha & Delta', 'Joint work', '$500.00', '2024', '2')]) }), e = desk(g);
    try {
      const summary = await sweepAwardSources(sweepDeps(g, e, { sources: ['numfocus-sdg'], autoApply: hook(g, e) }));
      assert.equal(summary.packets_queued, 1);
      assert.equal(summary.auto_applied, 0);
      assert.deepEqual(summary.left_for_owner[0].reasons, ['held_records:joint_beneficiary_needs_review']);
      assert.equal(summary.left_for_owner[0].queued, true);
      assert.equal(e.rows[0].state, 'pending');
      assert.equal(e.applies.length, 0);
    } finally { g.clean(); }
  });
});

test('each not-clean condition is named by the rule', async () => {
  const f = fixture();
  try {
    const { baseline, dataset } = f.load();
    const { compileFundingSourcePackets } = await import('../src/lib/funding-source-packets.mjs');
    const capture = await f.capture('numfocus-sdg');
    const compiled = compileFundingSourcePackets(capture.bundle.snapshots, baseline, dataset, TODAY);
    const pack = compiled.packets[0];
    const preview = await previewFundingPack(pack, f.load, AT);
    const base = { source: 'numfocus-sdg', compiled, pack, preview };
    assert.deepEqual(packetReasons(base), []);
    assert.deepEqual(mappingReasons('numfocus-sdg', pack, baseline), []);
    const clone = v => structuredClone(v);
    const withEvent = mutate => { const p = clone(pack); mutate(p.records['funding-events'][0]); return p; };
    const cases = [
      [{ ...base, source: 'manual-upload' }, 'source_not_allowlisted'],
      [{ ...base, compiled: { ...compiled, held: [{ reason: 'possible_legacy_award_duplicate' }] } }, 'held_records:possible_legacy_award_duplicate'],
      [{ ...base, compiled: { ...compiled, held: [{ reason: 'possible_existing_event_duplicate' }] } }, 'held_records:possible_existing_event_duplicate'],
      [{ ...base, compiled: { ...compiled, held: [{ reason: 'provider_value_conflict' }] } }, 'held_records:provider_value_conflict'],
      [{ ...base, compiled: { ...compiled, held: [{ reason: 'canonical_program_mapping_required' }] } }, 'held_records:canonical_program_mapping_required'],
      [{ ...base, compiled: { ...compiled, held: [{ reason: 'existing_key_changed_requires_supersession' }] } }, 'held_records:existing_key_changed_requires_supersession'],
      [{ ...base, compiled: { ...compiled, coverage_gaps: [{ reason: 'provider_scope_omission' }] } }, 'coverage_gaps'],
      [{ ...base, compiled: { ...compiled, source_failures: [{ error: 'x' }] } }, 'source_failures'],
      [{ ...base, compiled: { packets: [] } }, 'compile_output_unknown'],
      [{ ...base, preview: { ...preview, unchanged: { 'funding-events': 1 } } }, 'existing_keys_in_packet'],
      [{ ...base, preview: { ...preview, added: { 'funding-events': 1 } } }, 'not_all_records_new'],
      [{ ...base, preview: null }, 'preview_unknown'],
      [{ ...base, pack: withEvent(r => { r.supersedes_key = 'source:old'; }) }, 'supersedes_existing_key'],
      [{ ...base, pack: withEvent(r => { r.recipient_name = 'Gamma & Delta'; }) }, 'joint_beneficiary'],
      [{ ...base, pack: withEvent(r => { r.program = 'other-program'; }) }, 'program_mapping_mismatch'],
      [{ ...base, pack: withEvent(r => { r.funder = 'other-org'; }) }, 'issuer_mapping_mismatch'],
      [{ ...base, pack: withEvent(r => { r.event_type = 'paid'; }) }, 'event_type_not_awarded'],
      [{ ...base, pack: { ...clone(pack), records: { ...clone(pack.records), 'funding-events': Array(101).fill(pack.records['funding-events'][0]) } } }, 'pack_limits'],
      [{ ...base, pack: { ...clone(pack), records: { ...clone(pack.records), 'program-terms': [{ key: 'x', program: 'numfocus-small-development-grants' }] } } }, 'program_terms_not_auto'],
      [{ ...base, pack: { id: 'x' } }, 'pack_shape_unknown'],
    ];
    for (const [input, reason] of cases) assert.ok(packetReasons(input).includes(reason), `${reason}: ${JSON.stringify(packetReasons(input))}`);
    // Attributable held rows block only packets sharing their program and recipient.
    const heldFor = fact => ({ ...base, compiled: { ...compiled, held: [{ id: 'h', source_id: 'numfocus-sdg', fact, reason: 'possible_legacy_award_duplicate' }] } });
    assert.deepEqual(packetReasons(heldFor({ kind: 'award', recipient: 'numfocus-zeta', recipient_name: 'Zeta' })), []);
    assert.deepEqual(packetReasons(heldFor({ kind: 'award', recipient: 'numfocus-other', recipient_name: 'ALPHA' })), ['held_records:possible_legacy_award_duplicate']);
    assert.deepEqual(packetReasons(heldFor({ kind: 'award', recipient: 'numfocus-beta', recipient_name: 'B' })), ['held_records:possible_legacy_award_duplicate']);
    assert.deepEqual(packetReasons({ ...base, compiled: { ...compiled, held: [{ id: 'h', source_id: 'microsoft-foss', fact: { kind: 'award', recipient: 'x', recipient_name: 'Alpha' }, reason: 'r' }] } }), []);
    assert.deepEqual(packetReasons(heldFor({ kind: 'award' })), ['held_records:possible_legacy_award_duplicate']);
    assert.deepEqual(packetReasons({ ...base, compiled: { ...compiled, held: [{ id: 'h', source_id: 'numfocus-sdg', reason: 'provider_value_conflict', variants: [{ fact: { kind: 'award', recipient: 'numfocus-zeta', recipient_name: 'Zeta' } }] }] } }), []);
    const without = (list, id) => list.filter(x => x.id !== id);
    assert.deepEqual(mappingReasons('numfocus-sdg', pack, { ...baseline, programs: without(baseline.programs, 'numfocus-small-development-grants') }), ['program_not_in_registry']);
    assert.ok(mappingReasons('numfocus-sdg', pack, { ...baseline, orgs: without(baseline.orgs, 'numfocus') }).includes('program_not_in_registry'));
    assert.deepEqual(mappingReasons('numfocus-sdg', withEvent(r => { r.disburser_org = 'ghost-org'; }), baseline), ['org_not_in_registry']);
    assert.deepEqual(mappingReasons('numfocus-sdg', pack, { ...baseline, source_blobs: { ...baseline.source_blobs, 'orgs/numfocus.yaml': 'f'.repeat(40) } }), ['reference_guards_stale']);
    assert.deepEqual(mappingReasons('numfocus-sdg', pack, null), ['mapping_unknown']);
  } finally { f.clean(); }
});

test('a stale retry is left pending: the queued plan no longer matches current bytes', async () => {
  await withFlag('1', async () => {
    const f = fixture(), d = desk(f);
    try {
      // Queued together without auto-apply, so both plans expect the same dataset.
      await sweepAwardSources(sweepDeps(f, d));
      assert.ok(d.rows.every(r => r.origin === 'award_source_sweep'));
      const summary = await sweepAwardSources(sweepDeps(f, d, { now: () => NEXT_DAY, autoApply: hook(f, d) }));
      assert.equal(summary.auto_applied, 1);
      assert.equal(summary.auto_applied_retries, 1);
      assert.equal(summary.left_for_owner.length, 1);
      assert.equal(summary.left_for_owner[0].retry, true);
      assert.deepEqual(summary.left_for_owner[0].reasons, ['preview_changed']);
      assert.deepEqual(d.rows.map(r => r.state).sort(), ['approved', 'pending']);
    } finally { f.clean(); }
  });
});

test('a busy writer defers a clean packet and the next run applies it', async () => {
  await withFlag('1', async () => {
    const f = fixture(), d = desk(f);
    let decides = 0;
    try {
      const run1 = await sweepAwardSources(sweepDeps(f, d, {
        autoApply: hook(f, d, { writerBusy: () => true, decide: async () => { decides++; return { status: 200, body: {} }; } }),
      }));
      assert.equal(run1.auto_applied, 0);
      assert.deepEqual(run1.auto_apply_deferred.map(x => x.reasons), [['writer_busy'], ['writer_busy']]);
      assert.equal(decides, 0);
      assert.equal(d.rows.length, 0);
      const run2 = await sweepAwardSources(sweepDeps(f, d, { now: () => NEXT_DAY, autoApply: hook(f, d) }));
      assert.equal(run2.auto_applied, 2, JSON.stringify(run2));
      assert.ok(d.rows.every(r => r.state === 'approved'));
      // The lock appearing during the re-preview read leaves the queued packet pending.
      const f2 = fixture(), d2 = desk(f2);
      try {
        const busyLoad = () => { throw new Error('Funding writer is active'); };
        const s2 = await sweepAwardSources(sweepDeps(f2, d2, { sources: ['numfocus-sdg'], autoApply: hook(f2, d2, { load: busyLoad }) }));
        assert.deepEqual(s2.left_for_owner[0].reasons, ['writer_busy']);
        assert.equal(d2.rows[0].state, 'pending');
        // Next run the writer is free: the sweep retries its own pending packet.
        const s3 = await sweepAwardSources(sweepDeps(f2, d2, { sources: ['numfocus-sdg'], now: () => NEXT_DAY, autoApply: hook(f2, d2) }));
        assert.equal(s3.auto_applied_retries, 1, JSON.stringify(s3));
        assert.equal(d2.rows.length, 1);
        assert.equal(d2.rows[0].state, 'approved');
      } finally { f2.clean(); }
    } finally { f.clean(); }
  });
});

test('the per-run cap is respected, retries go first, and the leftover applies next run', async () => {
  assert.equal(MAX_AWARD_AUTO_APPLIES, 10);
  await withFlag('1', async () => {
    const f = fixture(), d = desk(f);
    try {
      const run1 = await sweepAwardSources(sweepDeps(f, d, { autoApply: hook(f, d, { maxApplies: 1 }) }));
      assert.equal(run1.auto_applied, 1);
      assert.deepEqual(run1.auto_apply_deferred.map(x => x.reasons), [['auto_apply_cap']]);
      assert.deepEqual(run1.left_for_owner, []);
      assert.deepEqual(d.rows.map(r => r.state), ['approved']);
      const run2 = await sweepAwardSources(sweepDeps(f, d, { now: () => NEXT_DAY, autoApply: hook(f, d, { maxApplies: 1 }) }));
      assert.equal(run2.auto_applied, 1, JSON.stringify(run2));
      assert.deepEqual(d.rows.map(r => r.state), ['approved', 'approved']);
    } finally { f.clean(); }
    // A pending sweep packet is retried before a new packet can spend the cap.
    const g = fixture(), e = desk(g);
    try {
      await sweepAwardSources(sweepDeps(g, e, { sources: ['royal-society-research'] }));
      const run = await sweepAwardSources(sweepDeps(g, e, { now: () => NEXT_DAY, autoApply: hook(g, e, { maxApplies: 1 }) }));
      assert.equal(run.auto_applied_retries, 1);
      assert.deepEqual(run.auto_apply_deferred.map(x => x.source), ['numfocus-sdg']);
      assert.deepEqual(e.rows.map(r => [r.program, r.state]), [['royal-society-research-grants', 'approved']]);
    } finally { g.clean(); }
  });
});

test('retries cover only the sweep\'s own pending packets and rely on the Desk claim', async () => {
  await withFlag('1', async () => {
    const f = fixture(), d = desk(f);
    try {
      await sweepAwardSources(sweepDeps(f, d, { sources: ['numfocus-sdg'] }));
      // Without the origin marker the packet is not the sweep's to retry.
      delete d.rows[0].origin;
      const unmarked = await sweepAwardSources(sweepDeps(f, d, { sources: ['numfocus-sdg'], now: () => NEXT_DAY, autoApply: hook(f, d) }));
      assert.equal(unmarked.auto_applied, 0);
      assert.equal(d.rows[0].state, 'pending');
      d.rows[0].origin = 'award_source_sweep';
      // The owner wins the claim between the sweep's read and its approval.
      const claim = d.deps.claimProposal;
      d.deps.claimProposal = async () => null;
      const raced = await sweepAwardSources(sweepDeps(f, d, { sources: ['numfocus-sdg'], now: () => NEXT_DAY, autoApply: hook(f, d) }));
      assert.equal(raced.auto_applied, 0);
      assert.deepEqual(raced.left_for_owner[0].reasons, ['apply_failed: already claimed or decided']);
      assert.equal(d.applies.length, 0);
      // An item the owner already decided is not retried at all.
      d.deps.claimProposal = claim;
      d.rows[0].state = 'rejected';
      const decided = await sweepAwardSources(sweepDeps(f, d, { sources: ['numfocus-sdg'], now: () => NEXT_DAY, autoApply: hook(f, d) }));
      assert.equal(decided.auto_applied, 0);
      assert.equal(decided.left_for_owner.filter(l => l.retry).length, 0);
      assert.equal(d.applies.length, 0);
    } finally { f.clean(); }
  });
});

test('packets with owner-rejected records are held, never re-queued or auto-applied', async () => {
  await withFlag('1', async () => {
    const f = fixture({ [NF_URL]: NF }), d = desk(f);
    try {
      await sweepAwardSources(sweepDeps(f, d, { sources: ['numfocus-sdg'] }));
      assert.equal(d.rows.length, 1);
      assert.equal((await decideProposal({ id: d.rows[0].id, decision: 'rejected', by: 'owner' }, d.deps)).status, 200);
      // A new row appears beside the two the owner rejected.
      f.pages[NF_URL] = nfPage([nfRow('Alpha', 'Alpha docs', '$1,000.00', '2024', '1'), nfRow('Beta', 'Beta tests', '$2,500.00', '2024', '2'), nfRow('Epsilon', 'Epsilon tools', '$900.00', '2025', '1')]);
      for (const now of [NEXT_DAY, new Date('2026-10-17T18:00:00Z')]) {
        const summary = await sweepAwardSources(sweepDeps(f, d, { sources: ['numfocus-sdg'], now: () => now, autoApply: hook(f, d) }));
        assert.equal(summary.packets_queued, 0);
        assert.equal(summary.packets_held, 1);
        assert.equal(summary.auto_applied, 0);
        assert.deepEqual(summary.left_for_owner, [{ source: 'numfocus-sdg', pack_id: 'source-numfocus-small-development-grants-001', retry: false, proposal_id: null, queued: false, reasons: ['contains_rejected_records'] }]);
      }
      assert.equal(d.rows.length, 1);
      assert.equal(d.applies.length, 0);
    } finally { f.clean(); }
  });
});

test('decide accepts the machine actor only for the exact award audit', async () => {
  await withFlag('1', async () => {
    const f = fixture(), d = desk(f);
    try {
      await sweepAwardSources(sweepDeps(f, d, { sources: ['numfocus-sdg'] }));
      const p = d.rows[0], digest = p.signal_id.slice('funding-v2:'.length);
      const audit = { policy: 'clean_first_party_award_packet_v1', source: 'numfocus-sdg', source_url: NF_URL, pack_id: 'x', plan_digest: digest, records: 2 };
      for (const input of [
        { by: 'machine' },
        { by: 'curator', award_auto_apply: audit },
        { by: 'machine', award_auto_apply: { ...audit, plan_digest: 'f'.repeat(64) } },
      ]) {
        const result = await decideProposal({ id: p.id, decision: 'approved', ...input }, d.deps);
        assert.equal(result.status, 403, JSON.stringify(input));
        assert.equal(p.state, 'pending');
      }
      // A machine rejection of a funding import is refused too.
      assert.equal((await decideProposal({ id: p.id, decision: 'rejected', by: 'machine', award_auto_apply: audit }, d.deps)).status, 403);
      // The audit cannot ride on a non-funding proposal.
      d.rows.push({ id: 'p09999', type: 'profile_note', state: 'pending', proposed_change: { 'orgs/numfocus.yaml': { name: 'x' } } });
      assert.equal((await decideProposal({ id: 'p09999', decision: 'approved', by: 'machine', award_auto_apply: audit }, d.deps)).status, 403);
    } finally { f.clean(); }
  });
});

test('a reconciliation hold stops auto-apply for the rest of the run', async () => {
  await withFlag('1', async () => {
    const f = fixture(), d = desk(f);
    let decides = 0;
    try {
      const summary = await sweepAwardSources(sweepDeps(f, d, {
        autoApply: hook(f, d, { decide: async () => { decides++; return { status: 500, body: { error: 'x', reconciliation_hold: true } }; } }),
      }));
      assert.equal(decides, 1);
      assert.deepEqual(summary.left_for_owner.map(l => l.reasons), [['reconciliation_hold'], ['halted_after_reconciliation_hold']]);
    } finally { f.clean(); }
  });
});

test('the sweep module itself still has no approval path', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/funding-source-sweep.mjs'), 'utf8');
  assert.doesNotMatch(source.replace(/^\/\/.*$/gm, ''), /recordVerdict|desk-decide|decideProposal|runValidation|committer/);
  const wiring = readFileSync(join(process.cwd(), 'src/lib/award-source-sweep.ts'), 'utf8');
  assert.match(wiring, /awardSourcesAutoApplyEnabled\(\)\s*\n?\s*\?/);
});
