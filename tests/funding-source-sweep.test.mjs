import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBaseline } from '../src/lib/funding-store.mjs';
import { readControlledFunding } from '../src/lib/funding-desk-core.mjs';
import { captureFundingTable } from '../src/lib/funding-source-html.mjs';
import { sweepAwardSources } from '../src/lib/funding-source-sweep.mjs';
import { runDailyIngestOnce } from '../src/lib/ingest.ts';

const AT = new Date('2026-10-15T18:00:00Z'), NEXT_DAY = new Date('2026-10-16T18:00:00Z');
const NF = '<h2>Previously Funded Programs</h2><table><tr><th>Project</th><th>Proposal Title</th><th>Amount</th><th>Year</th><th>Round</th></tr>'
  + '<tr><td>Alpha</td><td>Alpha docs</td><td>$1,000.00</td><td>2024</td><td>1</td></tr>'
  + '<tr><td>Beta</td><td>Beta tests</td><td>$2,500.00</td><td>2024</td><td>2</td></tr></table>';
const RS = '<p>Application and offer data does not include upgraded reserves.</p><table><tr><th>Financial year</th><th>Eligible applications</th><th>Offers</th><th>Success rate</th></tr><tr><td>2024/25</td><td>400</td><td>100</td><td>25.0%</td></tr></table>';
const PAGES = {
  'https://numfocus.org/programs/small-development-grants': NF,
  'https://royalsociety.org/grants/research-grants/': RS,
};

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'award-sweep-')), root = join(dir, 'registry');
  mkdirSync(join(root, 'orgs'), { recursive: true }); mkdirSync(join(root, 'programs'));
  const docs = [
    ['orgs', { id: 'numfocus', name: 'NumFOCUS', sources: ['https://numfocus.org'] }],
    ['orgs', { id: 'royal-society', name: 'Royal Society', sources: ['https://royalsociety.org'] }],
    ['programs', { id: 'numfocus-small-development-grants', org: 'numfocus', name: 'Small Development Grants', wires: ['oss'], rounds: [] }],
    ['programs', { id: 'royal-society-research-grants', org: 'royal-society', name: 'Research Grants', wires: ['science'], rounds: [] }],
  ];
  for (const [sub, doc] of docs) writeFileSync(join(root, sub, `${doc.id}.yaml`), JSON.stringify(doc));
  const load = () => ({ root, baseline: readBaseline(root, JSON.parse), dataset: readControlledFunding(root).dataset });
  return { dir, root, load, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

// The real capture clients, with only their injectable network replaced.
let requests = 0;
const capture = async source => captureFundingTable(source, {
  now: () => AT,
  request: async url => {
    requests++;
    if (!PAGES[url]) throw new Error('offline');
    return new Response(PAGES[url], { headers: { 'content-type': 'text/html' } });
  },
});

/** Stands in for insertIngestProposals: inserts pending rows, dedupes on signal_id. */
function deskQueue() {
  const rows = [];
  return {
    rows,
    proposals: async () => rows,
    enqueue: async candidates => {
      const inserted = candidates.filter(c => !rows.some(r => r.signal_id === c.signal_id)).map(c => ({ ...c, state: 'pending' }));
      rows.push(...inserted);
      return { inserted, skipped: candidates.length - inserted.length };
    },
  };
}

const deps = (f, desk, extra = {}) => ({
  enabled: true, fundingDeskEnabled: true, capture, load: f.load, proposals: desk.proposals, enqueue: desk.enqueue,
  sources: ['numfocus-sdg', 'royal-society-research'], now: () => AT, ...extra,
});

test('award sweep does nothing while its flag or the funding Desk is off', async () => {
  const untouched = () => { throw new Error('must not be called'); };
  for (const [enabled, fundingDeskEnabled, reason] of [[false, true, 'award_sources_disabled'], [true, false, 'funding_desk_disabled']]) {
    const summary = await sweepAwardSources({ enabled, fundingDeskEnabled, capture: untouched, load: untouched, proposals: untouched, enqueue: untouched });
    assert.equal(summary.skipped, reason);
    assert.equal(summary.sources_tried, 0);
  }
});

test('the daily run leaves the award sweep unloaded when AWARD_SOURCES_ENABLED is unset', async () => {
  const previous = process.env.AWARD_SOURCES_ENABLED;
  delete process.env.AWARD_SOURCES_ENABLED;
  try {
    const state = new Map();
    const out = await runDailyIngestOnce(AT, { getState: async k => state.get(k) ?? null, setState: async (k, v) => state.set(k, v), run: async () => ({ errors: [] }) });
    assert.equal(out.executed, true);
    assert.equal('award_sources' in out.result, false);
  } finally { if (previous !== undefined) process.env.AWARD_SOURCES_ENABLED = previous; }
});

test('award sweep queues new packets as pending Desk items and never approves', async () => {
  const f = fixture(), desk = deskQueue();
  try {
    const summary = await sweepAwardSources(deps(f, desk));
    assert.equal(summary.sources_failed, 0, JSON.stringify(summary));
    assert.equal(summary.packets_queued, 2);
    assert.equal(summary.approval, false);
    assert.equal(desk.rows.length, 2);
    for (const row of desk.rows) {
      assert.equal(row.state, 'pending');
      assert.equal(row.type, 'profile_note');
      assert.match(row.signal_id, /^funding-v2:[a-f0-9]{64}$/);
      assert.ok(row.proposed_change._funding_v2);
    }
    // Nothing reached the canonical ledgers: queueing is not publication.
    assert.deepEqual(readdirSync(f.root).sort(), ['orgs', 'programs']);
  } finally { f.clean(); }
});

test('repeat sweeps, same-digest packets and rejected packets are no-ops', async () => {
  const f = fixture(), desk = deskQueue();
  try {
    await sweepAwardSources(deps(f, desk));
    // Same day: identical digest. Next day: new observation date, same records.
    for (const now of [AT, NEXT_DAY]) {
      const again = await sweepAwardSources(deps(f, desk, { now: () => now }));
      assert.equal(again.packets_queued, 0);
      assert.equal(again.packets_repeated, 2);
      assert.equal(desk.rows.length, 2);
    }
    // Even when the queue read misses them, the store's digest dedupe holds.
    const blind = await sweepAwardSources(deps(f, desk, { proposals: async () => [] }));
    assert.equal(blind.packets_queued, 0);
    assert.equal(desk.rows.length, 2);
    // An owner rejection is a decision, not an invitation to requeue daily.
    for (const row of desk.rows) row.state = 'rejected';
    const afterReject = await sweepAwardSources(deps(f, desk, { now: () => NEXT_DAY }));
    assert.equal(afterReject.packets_queued, 0);
    assert.equal(desk.rows.length, 2);
  } finally { f.clean(); }
});

test('a failing source is recorded and the other sources still queue', async () => {
  const f = fixture(), desk = deskQueue();
  try {
    requests = 0;
    const summary = await sweepAwardSources(deps(f, desk, { sources: ['royal-society-urf', 'numfocus-sdg', 'royal-society-research'] }));
    assert.equal(summary.sources_tried, 3);
    assert.equal(summary.sources_failed, 1);
    assert.equal(summary.sources[0].status, 'failed');
    assert.equal(summary.sources[0].error, 'source_transport_failure');
    assert.equal(summary.packets_queued, 2);
    assert.equal(requests, 3);
  } finally { f.clean(); }
});

test('a broken award sweep never fails the daily Wire run', async () => {
  const state = new Map();
  const wire = { proposals_created: 4, errors: [] };
  const out = await runDailyIngestOnce(AT, {
    getState: async k => state.get(k) ?? null,
    setState: async (k, v) => state.set(k, v),
    run: async () => wire,
    sweep: async () => { throw new Error('funding snapshot unavailable'); },
  });
  assert.equal(out.executed, true);
  assert.equal(out.result.proposals_created, 4);
  assert.equal(out.result.award_sources.error, 'funding snapshot unavailable');
  assert.equal(state.get(`daily_ingest_claim:${out.day}`).status, 'completed');
});

test('the sweep has no approval path', () => {
  for (const path of ['src/lib/funding-source-sweep.mjs', 'src/lib/award-source-sweep.ts']) {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    assert.doesNotMatch(source, /recordVerdict|desk-decide|decideProposal|runValidation|committer/, path);
    assert.ok(existsSync(join(process.cwd(), path)));
  }
});
