import assert from 'node:assert/strict';
import test from 'node:test';
import YAML from 'yaml';

import { buildProposalChanges } from '../src/lib/committer.ts';
import { roundHistoryLabel } from '../src/lib/program-facts.ts';

const publicSummary = 'Rocket Pool Grants and Bounties Management Committee funds numbered rounds for protocol work.';

function proposal(overrides) {
  return {
    id: 'p90001',
    org: 'rocket-pool',
    org_name: 'Rocket Pool',
    program: 'Rocket Pool GMC Grants, Bounties & Retrospective Awards',
    title: 'Registry edit',
    summary: publicSummary,
    evidence_url: 'https://dao.rocketpool.net/t/round-41-gmc-call-for-grant-applications-deadline-is-october-7/4043',
    wire: 'crypto',
    lane: 'fact',
    state: 'pending',
    created_at: '2026-10-03T00:00:00.000Z',
    ...overrides,
  };
}

function written(result) {
  assert.equal(result.changes.length, 1);
  return YAML.parse(result.changes[0].content);
}

test('a status change writes its summary onto the program even when the patch omits it', () => {
  const doc = written(buildProposalChanges(proposal({
    type: 'status_change',
    proposed_change: { 'programs/rocket-pool-gmc-grants.yaml': { status: 'active' } },
  })));
  assert.equal(doc.summary, publicSummary);
  assert.equal(doc.rounds.find((round) => round.name === 'Round 41 grants').closes_at, '2026-10-07T23:59:00Z');
  assert.equal(doc.rounds.some((round) => round.name === '41'), false);
});

test('a round update narrative does not replace the program summary', () => {
  const doc = written(buildProposalChanges(proposal({
    type: 'round_update',
    summary: 'This narrative records a source check and must not become the public summary.',
    proposed_change: {
      'programs/rocket-pool-gmc-grants.yaml': {
        sources: ['https://dao.rocketpool.net/t/round-41-gmc-call-for-grant-applications-deadline-is-october-7/4043'],
      },
    },
  })));
  assert.match(doc.summary, /Grants and Bounties Management Committee/);
  assert.equal(doc.summary.includes('must not become'), false);
});

test('merging a duplicate round keeps the canonical round, its exact deadline, and the duplicate source', () => {
  const doc = written(buildProposalChanges(proposal({
    type: 'round_update',
    proposed_change: {
      'programs/rocket-pool-gmc-grants.yaml': {
        retire_round: 'Round 36 (Apr 7-May 7 2026)',
        keep_round: 'Round 41 grants',
        sources: ['https://dao.rocketpool.net/t/round-36-april-7-may-7-grants-bounties-retrospective-awards-results/3951'],
      },
    },
  })));
  assert.equal(doc.rounds.some((round) => round.name.startsWith('Round 36')), false);
  const kept = doc.rounds.find((round) => round.name === 'Round 41 grants');
  assert.equal(kept.closes_at, '2026-10-07T23:59:00Z');
  assert.equal(kept.closes, '2026-10-07');
  assert.equal(kept.status, 'open');
  assert.equal(kept.size, '$25,000 across 3 awards');
  assert.ok(doc.sources.includes('https://dao.rocketpool.net/t/round-36-april-7-may-7-grants-bounties-retrospective-awards-results/3951'));
  assert.deepEqual(doc.review.round_names, ['Round 41 grants']);
});

test('marking a round duplicate keeps its source and drops it from open lists', () => {
  const doc = written(buildProposalChanges(proposal({
    type: 'round_update',
    proposed_change: {
      'programs/rocket-pool-gmc-grants.yaml': {
        round_disposition: { name: 'Round 38 (June 7-July 7 2026)', status: 'duplicate' },
      },
    },
  })));
  const marked = doc.rounds.find((round) => round.name.startsWith('Round 38'));
  assert.equal(marked.status, 'duplicate');
  assert.match(marked.source, /round-38/);
  assert.equal(roundHistoryLabel(marked), 'Duplicate');
  assert.equal(doc.rounds.find((round) => round.name === 'Round 41 grants').status, 'open');
});

test('a profile note replaces a program display name and summary without changing its id', () => {
  const doc = written(buildProposalChanges(proposal({
    type: 'profile_note',
    lane: 'judgment',
    proposed_change: {
      'programs/rocket-pool-gmc-grants.yaml': {
        name: 'Rocket Pool GMC Grants',
        summary: publicSummary,
      },
    },
  })));
  assert.equal(doc.id, 'rocket-pool-gmc-grants');
  assert.equal(doc.name, 'Rocket Pool GMC Grants');
  assert.equal(doc.summary, publicSummary);
  assert.equal(doc.rounds.find((round) => round.name === 'Round 41 grants').closes_at, '2026-10-07T23:59:00Z');
});

test('an organization status change writes the submission summary onto the profile', () => {
  const profile = 'Rocket Pool runs a recurring grants committee for protocol and community work, documented on the DAO forum.';
  const doc = written(buildProposalChanges(proposal({
    type: 'status_change',
    org: 'rocket-pool',
    program: null,
    summary: profile,
    proposed_change: { 'orgs/rocket-pool.yaml': { status: 'active' } },
  })));
  assert.equal(doc.profile, profile);
  assert.equal(doc.id, 'rocket-pool');
  assert.ok(doc.sources.includes('https://dao.rocketpool.net/t/round-41-gmc-call-for-grant-applications-deadline-is-october-7/4043'));
});
