import assert from 'node:assert/strict';
import test from 'node:test';

import { decideProposal, proposalChangeHash } from '../src/lib/desk-decide.ts';

const CHANGE = { 'orgs/example.yaml': { socials: { x: 'https://x.com/example' } } };
const AUDIT = { key_id: 'hedwig', fetched_url: 'https://example.org/about', page_hash: 'h', old_value: null, new_value: 'https://x.com/example' };

function store(change = CHANGE, extra = {}) {
  const row = { id: 'p1', type: 'profile_note', org: 'example', title: 't', summary: 's', lane: 'judgment', state: 'pending', created_at: '2026-10-14T00:00:00Z', proposed_change: change, ...extra };
  const released = [];
  const applied = [];
  const deps = {
    getProposal: async () => row,
    claimProposal: async () => {
      if (row.state !== 'pending') return null;
      row.state = 'applying';
      return row;
    },
    releaseProposalClaim: async (id) => {
      released.push(id);
      if (row.state === 'applying') row.state = 'pending';
    },
    recordVerdict: async (id, decision, opts) => {
      row.state = decision;
      return { proposal: { ...row }, verdict: { proposal_id: id, decision, at: 'now', ...opts } };
    },
    applyProposalDurably: async (proposal) => {
      applied.push(proposal.id);
      return { notes: [], changes: [], commit: null };
    },
    registryMayHaveChanged: () => false,
  };
  return { row, released, applied, deps };
}

const curatorAuto = (extra = {}) => ({ id: 'p1', decision: 'approved', by: 'curator', curator_id: 'hedwig', curator_name: 'Hedwig', auto_apply: AUDIT, ...extra });

test('proposalChangeHash ignores key order', () => {
  assert.equal(proposalChangeHash({ a: 1, b: { c: 2, d: 3 } }), proposalChangeHash({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(proposalChangeHash({ a: 1 }), proposalChangeHash({ a: 2 }));
});

test('a matching change hash is approved', async () => {
  const s = store();
  const result = await decideProposal(curatorAuto({ expect_change_hash: proposalChangeHash(CHANGE) }), s.deps);
  assert.equal(result.status, 200);
  assert.deepEqual(s.applied, ['p1']);
  assert.equal(s.row.state, 'approved');
});

test('a payload changed since the check is refused and its claim released', async () => {
  const checked = proposalChangeHash(CHANGE);
  const s = store({ 'orgs/example.yaml': { socials: { x: 'https://x.com/attacker' } } });
  const result = await decideProposal(curatorAuto({ expect_change_hash: checked }), s.deps);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'changed_since_check');
  assert.deepEqual(s.applied, []);
  assert.deepEqual(s.released, ['p1']);
  assert.equal(s.row.state, 'pending');
});

test('automatic approvals without a change hash are refused before any claim', async () => {
  const wireAudit = { policy: 'p', fetched_url: 'u', final_url: 'u', page_hash: 'h', matched_name: 'n', matched_signal: 's', score: 90 };
  const awardAudit = { policy: 'p', source: 's', source_url: 'u', pack_id: 'x', plan_digest: 'd', records: 1 };
  const previous = { wire: process.env.WIRE_PROGRAM_AUTO_APPLY, award: process.env.AWARD_SOURCES_AUTO_APPLY };
  process.env.WIRE_PROGRAM_AUTO_APPLY = '1';
  process.env.AWARD_SOURCES_AUTO_APPLY = '1';
  try {
    const cases = [
      ['curator auto_apply', store(), curatorAuto()],
      ['machine auto_apply', store(), { id: 'p1', decision: 'approved', by: 'machine', auto_apply: AUDIT }],
      [
        'wire program audit',
        store({ 'programs/x.yaml': { id: 'x', name: 'X' } }, { type: 'new_program', signal_id: 'wire:1' }),
        { id: 'p1', decision: 'approved', by: 'machine', wire_program_auto_apply: wireAudit },
      ],
      [
        'award audit',
        store({ _funding_v2: {} }, { signal_id: 'funding-v2:d' }),
        { id: 'p1', decision: 'approved', by: 'machine', award_auto_apply: awardAudit },
      ],
    ];
    for (const [label, s, input] of cases) {
      const result = await decideProposal(input, s.deps);
      assert.equal(result.status, 400, label);
      assert.equal(result.body.error, 'change_hash_required', label);
      assert.equal(s.row.state, 'pending', label);
      assert.deepEqual(s.applied, [], label);
    }
  } finally {
    for (const [key, value] of [['WIRE_PROGRAM_AUTO_APPLY', previous.wire], ['AWARD_SOURCES_AUTO_APPLY', previous.award]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('owner decisions and plain rejections need no change hash', async () => {
  const owner = store();
  assert.equal((await decideProposal({ id: 'p1', decision: 'approved' }, owner.deps)).status, 200);
  const machine = store();
  assert.equal((await decideProposal({ id: 'p1', decision: 'rejected', by: 'machine', note: 'auto: stale (pending 30+ days)' }, machine.deps)).status, 200);
});
