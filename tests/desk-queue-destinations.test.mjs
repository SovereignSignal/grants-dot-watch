import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import YAML from 'yaml';

// The queue shows each proposal's destination without the funding dataset validation that
// approval runs. It must name exactly the paths approval would write.
const file = 'programs/rocket-pool-gmc-grants.yaml';
const raw = readFileSync(`registry/${file}`, 'utf8');
const program = YAML.parse(raw);
const proposal = (hash) => ({
  id: 'queue-destination', type: 'profile_note', org: program.org, title: 'Correction', summary: 'Queue destination',
  evidence_url: 'https://example.org', state: 'pending', lane: 'judgment', created_at: '2026-10-14T00:00:00Z',
  proposed_change: { _expected_content_hashes: { [file]: hash }, [file]: { review: { ...program.review } } },
});

for (const funding of ['1', '0']) {
  test(`queue destinations match the paths approval writes (funding desk ${funding})`, async t => {
    const before = process.env.GRANTS_WATCH_FUNDING_DESK;
    process.env.GRANTS_WATCH_FUNDING_DESK = funding;
    t.after(() => { if (before === undefined) delete process.env.GRANTS_WATCH_FUNDING_DESK; else process.env.GRANTS_WATCH_FUNDING_DESK = before; });
    const { buildProposalChanges, proposalDestinations } = await import('../src/lib/committer.ts');
    const fresh = proposal(createHash('sha256').update(raw).digest('hex'));
    const destinations = proposalDestinations(fresh);
    assert.deepEqual(destinations, buildProposalChanges(fresh).changes.map(change => change.path));
    assert.ok(destinations.includes('registry/funding-control.json'));
    assert.ok(destinations.includes(`registry/${file}`));
    const stale = proposal('0'.repeat(64));
    assert.throws(() => proposalDestinations(stale), /stale/);
  });
}

test('queue cards resolve destinations only for proposals awaiting action', async () => {
  const { queueDestination } = await import('../src/lib/committer.ts');
  const stale = proposal('0'.repeat(64));
  assert.match(queueDestination(stale).error, /stale/);
  assert.match(queueDestination({ ...stale, state: 'applying' }).error, /stale/);
  // Decided proposals never run a build, so a stale or heavy one costs nothing.
  for (const state of ['approved', 'rejected']) assert.deepEqual(queueDestination({ ...stale, state }), { paths: null, error: null });
});
