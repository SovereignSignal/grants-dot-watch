import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { deskUpkeepEnabled, runDeskUpkeep, X_HANDLE_BACKLOG_CAP } from '../src/lib/desk-upkeep.ts';
import { curatorKeyStanding } from '../src/lib/curator-auth.ts';
import { decideProposal } from '../src/lib/desk-decide.ts';
import { runDailyIngestOnce } from '../src/lib/ingest.ts';

const NOW = new Date('2026-10-15T17:00:00.000Z');
const PAGE = '<footer><a href="https://x.com/example">X</a></footer>';
const PAGE_HASH = createHash('sha256').update(PAGE).digest('hex');

const ORGS = [
  { id: 'example', name: 'Example', website: 'https://www.example.org', socials: { x: 'https://x.com/oldhandle' } },
  { id: 'other', name: 'Other', website: 'https://other.org' },
];

function xNote(id, { orgId = 'example', handle = 'example', clear = false, stamp = true, quote, createdAt = '2026-10-14T12:00:00.000Z' } = {}) {
  return {
    id,
    type: 'profile_note',
    org: orgId,
    title: `${orgId}: X @${handle}`,
    summary: 'The org site links this X account.',
    lane: 'judgment',
    state: 'pending',
    created_at: createdAt,
    proposed_change: { [`orgs/${orgId}.yaml`]: { socials: { x: clear ? null : `https://x.com/${handle}` } } },
    ...(stamp
      ? {
          submitted_by: {
            key_id: 'hedwig',
            key_name: 'Hedwig',
            reason: 'The official site footer links the handle.',
            sources: [`https://${orgId}.org/about`],
            quotes: [{ url: `https://${orgId}.org/about`, quote: quote ?? `Follow us at https://x.com/${handle}` }],
            at: createdAt,
          },
        }
      : {}),
  };
}

function harness(pending, overrides = {}) {
  const decisions = [];
  const fetched = [];
  let pauses = 0;
  const deps = {
    listPending: async () => pending,
    decide: async (input) => {
      decisions.push(input);
      const proposal = pending.find((p) => p.id === input.id);
      return { status: 200, body: { ok: true, proposal: { ...proposal, state: input.decision } } };
    },
    orgs: () => ORGS,
    fetchPage: async (url) => {
      fetched.push(url);
      return { ok: true, body: PAGE, hash: PAGE_HASH, url };
    },
    curatorKey: (id) =>
      id === 'hedwig' ? { status: 'active', identity: { id, name: 'Hedwig', scopes: ['propose', 'apply_low_risk'] } } : { status: 'unknown' },
    autoApplyEnabled: () => true,
    autoApplyTypes: () => new Set(['x_handle']),
    enabled: () => true,
    now: () => NOW,
    pause: async () => {
      pauses += 1;
    },
    ...overrides,
  };
  return { deps, decisions, fetched, pauses: () => pauses };
}

test('desk upkeep is off unless DESK_UPKEEP_ENABLED=1', async () => {
  assert.equal(deskUpkeepEnabled({}), false);
  assert.equal(deskUpkeepEnabled({ DESK_UPKEEP_ENABLED: 'true' }), false);
  assert.equal(deskUpkeepEnabled({ DESK_UPKEEP_ENABLED: '1' }), true);
  let listed = false;
  const { deps, decisions } = harness([xNote('p1')], {
    enabled: () => false,
    listPending: async () => {
      listed = true;
      return [];
    },
  });
  const summary = await runDeskUpkeep(deps);
  assert.equal(summary.skipped, 'desk_upkeep_disabled');
  assert.equal(listed, false);
  assert.equal(decisions.length, 0);
});

test('a backlog X handle that passes the curator check is approved with its audit', async () => {
  const { deps, decisions, fetched } = harness([xNote('p1')]);
  const summary = await runDeskUpkeep(deps);
  assert.equal(summary.x_handles_applied, 1);
  assert.equal(summary.x_handles_left, 0);
  assert.deepEqual(fetched, ['https://example.org/about']);
  assert.equal(decisions.length, 1);
  const [input] = decisions;
  assert.equal(input.id, 'p1');
  assert.equal(input.decision, 'approved');
  assert.equal(input.by, 'curator');
  assert.equal(input.curator_id, 'hedwig');
  assert.equal(input.curator_name, 'Hedwig');
  assert.match(input.note, /^auto: daily backlog check\./);
  assert.deepEqual(input.auto_apply, {
    key_id: 'hedwig',
    fetched_url: 'https://example.org/about',
    page_hash: PAGE_HASH,
    old_value: 'https://x.com/oldhandle',
    new_value: 'https://x.com/example',
  });
});

test('a backlog X handle that fails the check stays pending with its reason', async () => {
  const pending = [
    xNote('p1', { quote: 'No handle in this quote.' }),
    xNote('p2', { orgId: 'other', handle: 'other' }),
    xNote('p3', { stamp: false }),
  ];
  const { deps, decisions } = harness(pending, {
    fetchPage: async (url) => (url.includes('other.org') ? { ok: true, body: '<p>nothing</p>', hash: 'h', url } : { ok: false, reason: 'fetch_failed' }),
  });
  const summary = await runDeskUpkeep(deps);
  assert.equal(decisions.length, 0);
  assert.equal(summary.x_handles_applied, 0);
  assert.equal(summary.x_handles_left, 3);
  assert.deepEqual(summary.x_handles_reasons, { quote_mismatch: 1, page_missing_link: 1, no_curator_stamp: 1 });
});

function keyConfig(records) {
  return JSON.stringify(
    records.map((record) => ({
      sha256: createHash('sha256').update(record.id).digest('hex'),
      expires_at: '2099-01-01T00:00:00.000Z',
      revoked: false,
      ...record,
    }))
  );
}

test('the backlog pass approves only for an active filing key that holds apply_low_risk', async () => {
  const config = keyConfig([
    { id: 'hedwig', name: 'Hedwig', scopes: ['propose', 'apply_low_risk'] },
    { id: 'scout', name: 'Scout', scopes: ['propose'] },
    { id: 'gone', name: 'Gone', scopes: ['apply_low_risk'], revoked: true },
    { id: 'old', name: 'Old', scopes: ['apply_low_risk'], expires_at: '2026-01-01T00:00:00.000Z' },
  ]);
  const withKey = (id, keyId) => {
    const note = xNote(id);
    note.submitted_by = { ...note.submitted_by, key_id: keyId, key_name: keyId };
    return note;
  };
  const pending = [withKey('p1', 'hedwig'), withKey('p2', 'scout'), withKey('p3', 'gone'), withKey('p4', 'old'), withKey('p5', 'nobody'), xNote('p6', { stamp: false })];
  const { deps, decisions, fetched } = harness(pending, { curatorKey: (id) => curatorKeyStanding(id, () => config, () => NOW.getTime()) });
  const summary = await runDeskUpkeep(deps);
  assert.deepEqual(decisions.map((d) => [d.id, d.curator_id, d.curator_name]), [['p1', 'hedwig', 'Hedwig']]);
  assert.equal(fetched.length, 1);
  assert.equal(summary.x_handles_applied, 1);
  assert.deepEqual(summary.x_handles_reasons, {
    curator_lacks_apply_low_risk: 1,
    curator_key_inactive: 2,
    curator_key_unknown: 1,
    no_curator_stamp: 1,
  });
});

test('curatorKeyStanding reports unavailable keys without throwing', () => {
  assert.deepEqual(curatorKeyStanding('hedwig', () => 'not json'), { status: 'unavailable' });
  assert.deepEqual(curatorKeyStanding('hedwig', () => undefined), { status: 'unknown' });
});

test('a failed approval leaves the item pending and does not throw', async () => {
  const { deps } = harness([xNote('p1'), xNote('p2')], {
    decide: async (input) => {
      if (input.id === 'p1') throw new Error('ledger busy');
      return { status: 409, body: { error: 'already claimed or decided' } };
    },
  });
  const summary = await runDeskUpkeep(deps);
  assert.equal(summary.x_handles_applied, 0);
  assert.equal(summary.x_handles_left, 2);
  assert.deepEqual(summary.x_handles_reasons, { apply_failed: 2 });
  assert.deepEqual(summary.errors, ['p1: ledger busy']);
});

test('an X handle clear is never approved by the backlog pass', async () => {
  const { deps, decisions, fetched } = harness([xNote('p1', { clear: true })]);
  const summary = await runDeskUpkeep(deps);
  assert.equal(decisions.length, 0);
  assert.equal(fetched.length, 0);
  assert.equal(summary.x_handles_left, 1);
  assert.deepEqual(summary.x_handles_reasons, { clear_not_auto: 1 });
});

test('the backlog pass respects its per-run cap and yields between items', async () => {
  const pending = Array.from({ length: X_HANDLE_BACKLOG_CAP + 5 }, (_, i) => xNote(`p${i + 1}`));
  const h = harness(pending);
  const summary = await runDeskUpkeep(h.deps);
  assert.equal(h.fetched.length, X_HANDLE_BACKLOG_CAP);
  assert.equal(summary.x_handles_applied, X_HANDLE_BACKLOG_CAP);
  assert.equal(summary.x_handles_left, 5);
  assert.deepEqual(summary.x_handles_reasons, { over_cap: 5 });
  assert.equal(h.pauses(), X_HANDLE_BACKLOG_CAP - 1);
});

test('the backlog pass honors CURATOR_AUTO_APPLY and CURATOR_AUTO_APPLY_TYPES', async () => {
  const off = harness([xNote('p1')], { autoApplyEnabled: () => false });
  const offSummary = await runDeskUpkeep(off.deps);
  assert.equal(offSummary.x_handles_skipped, 'auto_apply_disabled');
  assert.equal(offSummary.x_handles_left, 1);
  assert.equal(off.decisions.length + off.fetched.length, 0);

  const notListed = harness([xNote('p1')], { autoApplyTypes: () => new Set() });
  const typesSummary = await runDeskUpkeep(notListed.deps);
  assert.equal(typesSummary.x_handles_skipped, 'x_handle_not_allowed');
  assert.equal(notListed.decisions.length + notListed.fetched.length, 0);
});

test('the backlog pass ignores funding imports and non-handle profile notes', async () => {
  const funding = { ...xNote('p1'), proposed_change: { _funding_v2: {}, 'orgs/example.yaml': { socials: { x: 'https://x.com/example' } } } };
  const profile = { ...xNote('p2'), proposed_change: { 'orgs/example.yaml': { profile: 'New text.' } } };
  const { deps, decisions } = harness([funding, profile]);
  const summary = await runDeskUpkeep(deps);
  assert.equal(decisions.length, 0);
  assert.equal(summary.x_handles_left, 0);
});

/** In-memory store under the real decideProposal. Approval writes nothing. */
function realDesk(rows) {
  const verdicts = [];
  const applied = [];
  const deps = {
    getProposal: async (id) => rows.find((r) => r.id === id) ?? null,
    claimProposal: async (id) => {
      const row = rows.find((r) => r.id === id && r.state === 'pending');
      if (!row) return null;
      row.state = 'applying';
      return row;
    },
    releaseProposalClaim: async (id) => {
      const row = rows.find((r) => r.id === id);
      if (row?.state === 'applying') row.state = 'pending';
    },
    recordVerdict: async (id, decision, opts) => {
      const row = rows.find((r) => r.id === id);
      const from = opts.from ?? 'pending';
      if (row.state !== from) throw new Error(`proposal ${id} is no longer ${from}`);
      row.state = decision;
      row.decision_note = opts.note;
      const verdict = { proposal_id: id, decision, at: NOW.toISOString(), ...opts };
      verdicts.push(verdict);
      return { proposal: { ...row }, verdict };
    },
    applyProposalDurably: async (proposal) => {
      applied.push(proposal.id);
      return { notes: [], changes: [], commit: null };
    },
    registryMayHaveChanged: () => false,
  };
  return { verdicts, applied, decide: (input) => decideProposal(input, deps) };
}

test('a backlog approval goes through decideProposal as a curator auto-apply verdict', async () => {
  const rows = [xNote('p1')];
  const desk = realDesk(rows);
  const { deps } = harness(rows, { listPending: async () => rows.filter((r) => r.state === 'pending'), decide: desk.decide });
  const summary = await runDeskUpkeep(deps);
  assert.equal(summary.x_handles_applied, 1);
  assert.deepEqual(desk.applied, ['p1']);
  assert.equal(rows[0].state, 'approved');
  const [verdict] = desk.verdicts;
  assert.equal(verdict.by, 'curator');
  assert.equal(verdict.curator_id, 'hedwig');
  assert.equal(verdict.auto_apply.page_hash, PAGE_HASH);
});

test('the daily run records the desk upkeep summary and survives its failure', async () => {
  const state = new Map();
  const base = {
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
  const order = [];
  const summary = { at: NOW.toISOString(), skipped: null, x_handles_applied: 2, x_handles_left: 1 };
  const ran = await runDailyIngestOnce(NOW, {
    getState: async (key) => state.get(key) ?? null,
    setState: async (key, value) => state.set(key, value),
    run: async () => {
      order.push('wire');
      return { ...base };
    },
    sweep: async () => {
      order.push('awards');
      return null;
    },
    upkeep: async () => {
      order.push('upkeep');
      return summary;
    },
  });
  assert.deepEqual(order, ['wire', 'awards', 'upkeep']);
  assert.deepEqual(ran.result.desk_upkeep, summary);

  const failed = await runDailyIngestOnce(new Date('2026-10-16T17:00:00.000Z'), {
    getState: async (key) => state.get(key) ?? null,
    setState: async (key, value) => state.set(key, value),
    run: async () => ({ ...base }),
    sweep: async () => null,
    upkeep: async () => {
      throw new Error('queue down');
    },
  });
  assert.equal(failed.executed, true);
  assert.equal(failed.result.desk_upkeep.error, 'queue down');
  assert.equal(state.get('daily_ingest_claim:2026-10-16').status, 'completed');
});
