import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWireMappings, resolveWireMappings, reviewWireMappings, wireHistoryHash, WIRE_MAPPING_STATE } from '../src/lib/wire-mappings.ts';
const proposal = (target = 'retired', patch = {}) => ({ id: 'p1', signal_id: 'wire:1', state: 'approved', proposed_change: { [`programs/${target}.yaml`]: { summary: 'Old contents' } }, ...patch });
const proposals = [proposal()];
const current = { org: 'example', hash: 'a'.repeat(64) };
const target = id => id === 'canonical' ? current : null;
const packet = (patch = {}) => ({ version: 1, reviewed_by: 'Fixture reviewer', reviewed_at: '2026-09-25T00:00:00Z', mappings: [{ wire_id: 1, from_program_id: 'retired', to_program_id: 'canonical', expected_target_hash: current.hash, expected_history_hash: wireHistoryHash(proposals, 1), reason: 'Official program consolidation', evidence: ['https://example.org/grants'], ...patch }] });
test('retired approvals remain unresolved until a reviewed identity decision exists', () => {
  assert.equal(resolveWireMappings(proposals, null, target).size, 0);
  const plan = prepareWireMappings(packet(), proposals, null, target);
  assert.equal(plan.additions, 1);
  assert.equal(resolveWireMappings(proposals, plan.after, target).get(1), 'canonical');
  assert.equal(proposals[0].proposed_change['programs/retired.yaml'].summary, 'Old contents');
});
test('identity survives ordinary edits but expires on changed ownership, missing targets or changed approved history', () => {
  const state = prepareWireMappings(packet(), proposals, null, target).after;
  assert.equal(resolveWireMappings(proposals, state, id => id === 'canonical' ? { ...current, hash: 'b'.repeat(64) } : null).get(1), 'canonical');
  assert.equal(resolveWireMappings(proposals, state, id => id === 'canonical' ? { ...current, org: 'another' } : null).size, 0);
  assert.equal(resolveWireMappings(proposals, state, () => null).size, 0);
  assert.equal(resolveWireMappings([proposal('retired', { id: 'changed' })], state, target).size, 0);
  assert.equal(resolveWireMappings([proposal('retired', { state: 'rejected' })], state, target).size, 0);
});
test('surviving approved targets take priority and conflicting surviving approvals stay unresolved', () => {
  const state = prepareWireMappings(packet(), proposals, null, target).after;
  const approved = [...proposals, proposal('current', { id: 'p2' })];
  const live = id => ['canonical', 'current', 'other'].includes(id) ? current : null;
  assert.equal(resolveWireMappings(approved, state, live).get(1), 'current');
  assert.equal(resolveWireMappings([...approved, proposal('other', { id: 'p3' })], state, live).size, 0);
});
test('invalid, unapproved, ambiguous and drifted batches fail before any write', () => {
  for (const patch of [{ wire_id: -1 }, { from_program_id: '../escape' }, { expected_target_hash: 'b'.repeat(64) }, { expected_history_hash: 'b'.repeat(64) }, { evidence: [] }, { evidence: ['javascript:alert(1)'] }, { extra: true }]) {
    assert.throws(() => prepareWireMappings(packet(patch), proposals, null, target));
  }
  assert.throws(() => prepareWireMappings(packet(), [], null, target), /historical approval/);
  assert.throws(() => prepareWireMappings(packet(), [...proposals, proposal('other')], null, target), /ambiguous/);
  assert.throws(() => prepareWireMappings(packet(), proposals, null, () => current), /still exists/);
  assert.throws(() => prepareWireMappings({ ...packet(), mappings: Array(201).fill(packet().mappings[0]) }, proposals, null, target), /200/);
  assert.throws(() => prepareWireMappings({ ...packet(), mappings: Array(2).fill(packet().mappings[0]) }, proposals, null, target), /Repeated/);
});
test('accepted decisions cannot be silently replaced and corrupt stored state fails closed', () => {
  const state = prepareWireMappings(packet(), proposals, null, target).after;
  assert.equal(prepareWireMappings(packet(), proposals, state, target).unchanged, 1);
  assert.throws(() => prepareWireMappings(packet({ reason: 'Changed decision' }), proposals, state, target), /immutable/);
  for (const invalid of [{}, { version: 1, decisions: [{}] }, { ...state, decisions: [...state.decisions, ...state.decisions] }]) {
    assert.throws(() => resolveWireMappings(proposals, invalid, target));
  }
});
test('preview is read-only; save is atomic, serialized and bound to the whole reviewed plan', async () => {
  let stored = null, writes = 0;
  const deps = { proposals: async () => proposals, target, getState: async () => stored,
    setState: async (key, value) => { assert.equal(key, WIRE_MAPPING_STATE); writes++; stored = value; },
    lock: async fn => ({ ran: true, result: await fn() }) };
  const preview = await reviewWireMappings(packet(), {}, deps);
  assert.equal(writes, 0); assert.equal(preview.saved, false);
  await assert.rejects(reviewWireMappings(packet(), { save: true, expectedPlan: 'wrong' }, deps), /Plan changed/);
  const failedBatch = { ...packet(), mappings: [...packet().mappings, { ...packet().mappings[0], wire_id: 2 }] };
  await assert.rejects(reviewWireMappings(failedBatch, { save: true, expectedPlan: preview.plan_hash }, deps), /historical approval/);
  assert.equal(writes, 0);
  await reviewWireMappings(packet(), { save: true, expectedPlan: preview.plan_hash }, deps); assert.equal(writes, 1);
  await assert.rejects(reviewWireMappings(packet(), { save: true, expectedPlan: preview.plan_hash }, deps), /Plan changed/);
  const repeat = await reviewWireMappings(packet(), {}, deps);
  await reviewWireMappings(packet(), { save: true, expectedPlan: repeat.plan_hash }, deps); assert.equal(writes, 1);
  await assert.rejects(reviewWireMappings(packet(), {}, { ...deps, lock: async () => ({ ran: false }) }), /Another intake/);
});
