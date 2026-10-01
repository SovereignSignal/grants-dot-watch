import assert from 'node:assert/strict';
import test from 'node:test';

import { PRIMARY_NAV } from '../src/components/primary-nav.ts';
import { proposerLabel, reviewBrief } from '../src/app/admin/desk/review-brief.ts';

const arpa = {
  type: 'new_org',
  org: null,
  org_name: 'ARPA-E (Advanced Research Projects Agency-Energy)',
  title: 'Sweep: ARPA-E — us-federal-rd funder',
  evidence_url: 'https://arpa-e.energy.gov/homepage',
  proposed_change: {
    'orgs/arpa-e-advanced-research-projects-agency-energy.yaml': {
      id: 'arpa-e-advanced-research-projects-agency-energy',
      name: 'ARPA-E (Advanced Research Projects Agency-Energy)',
      website: 'https://arpa-e.energy.gov',
      status: 'active',
      wires: ['ai'],
      roles: ['funder'],
    },
  },
  wire: 'ai',
};

test('a sweep card leads with a check, the official domain, and plain facts', () => {
  const brief = reviewBrief(arpa);
  assert.equal(brief.call, 'check');
  assert.equal(brief.reason, 'Official page is on file, but there is no verbatim quote.');
  assert.equal(brief.reasonFromProposal, false);
  assert.equal(brief.title, 'ARPA-E (Advanced Research Projects Agency-Energy)');
  assert.equal(brief.unsourced, false);
  assert.equal(brief.sources[0].domain, 'arpa-e.energy.gov');
  assert.deepEqual(brief.sources[0].quotes, []);
  assert.equal(brief.proposer, 'Sweep');
  const facts = Object.fromEntries(brief.facts.map((fact) => [fact.label, fact]));
  assert.equal(facts.Name.value, brief.title);
  assert.equal(facts.Org.value, 'Not on file');
  assert.equal(facts.Org.href, undefined);
  assert.equal(facts.Kind.value, 'New organization');
  assert.equal(facts.Wire.value, 'AI');
  assert.equal(facts.Status.value, 'Active');
  assert.equal(facts.Website.value, 'arpa-e.energy.gov');
  assert.equal(facts.Website.href, 'https://arpa-e.energy.gov/');
  assert.equal(facts.Deadline, undefined);
  assert.equal(facts.Amount, undefined);
});

test('a curator proposal recommends approve and keeps the reason and quote', () => {
  const brief = reviewBrief({
    type: 'new_program',
    org: 'optimism-foundation',
    org_name: 'Optimism Foundation',
    program: 'Retro Funding 2026',
    title: 'Sweep: Retro Funding 2026 (optimism-foundation)',
    evidence_url: 'https://atlas.optimism.io/rounds',
    wire: 'crypto',
    proposed_change: {
      'programs/retro-funding-2026.yaml': {
        name: 'Retro Funding 2026',
        org: 'optimism-foundation',
        status: 'active',
        apply_url: 'https://atlas.optimism.io/rounds',
        rounds: [{ name: '2026', status: 'open', closes: '2026-12-01', size: 'up to 8M OP' }],
      },
    },
    submitted_by: {
      key_id: 'hedwig',
      key_name: 'Hedwig',
      reason: 'The foundation page describes a 2026 round that is not on file. Extra clause stays off the card.',
      sources: ['https://atlas.optimism.io/rounds'],
      quotes: [{ url: 'https://atlas.optimism.io/rounds', quote: 'Applications close on 1 December 2026.' }],
      at: '2026-09-29T12:00:00Z',
    },
  });
  assert.equal(brief.call, 'approve');
  assert.equal(brief.reason, 'The foundation page describes a 2026 round that is not on file.');
  assert.equal(brief.reasonFromProposal, true);
  assert.equal(brief.title, 'Retro Funding 2026');
  assert.equal(brief.proposer, 'Hedwig');
  assert.deepEqual(brief.sources[0].quotes, ['Applications close on 1 December 2026.']);
  assert.equal(brief.sources[0].domain, 'atlas.optimism.io');
  const facts = Object.fromEntries(brief.facts.map((fact) => [fact.label, fact]));
  assert.equal(facts.Org.value, 'Optimism Foundation');
  assert.equal(facts.Org.href, '/orgs/optimism-foundation');
  assert.equal(facts.Status.value, 'Open');
  assert.equal(facts.Deadline.value, 'Dec 1, 2026');
  assert.equal(facts.Amount.value, 'up to 8M OP');
  assert.equal(facts.Website.href, 'https://atlas.optimism.io/rounds');
});

test('a proposal with no URL is unsourced and a deletion is reject', () => {
  const bare = reviewBrief({
    type: 'new_org',
    org: null,
    org_name: 'Untitled Circle',
    title: 'Sweep: Untitled Circle — maybe a funder',
    proposed_change: { 'orgs/untitled-circle.yaml': { name: 'Untitled Circle', status: 'unknown' } },
    wire: 'oss',
  });
  assert.equal(bare.call, 'check');
  assert.equal(bare.unsourced, true);
  assert.equal(bare.sources.length, 0);
  assert.match(bare.reason, /No official source/);

  const deletion = reviewBrief({
    type: 'profile_note',
    org: 'optimism-foundation',
    org_name: 'Optimism Foundation',
    title: 'Drop the old profile',
    proposed_change: { 'orgs/optimism-foundation.yaml': { delete: true } },
    evidence_url: 'https://optimism.io',
    wire: 'crypto',
  });
  assert.equal(deletion.call, 'reject');
  assert.match(deletion.reason, /delete or remove/);
});

test('a curator review replaces the generated verdict and highlights corrected facts', () => {
  const brief = reviewBrief({
    ...arpa,
    curator_review: {
      verdict: 'reject',
      reason: 'The page describes a research office, not an open grant.',
      sources: [{ url: 'https://arpa-e.energy.gov/about', quote: 'ARPA-E advances high-potential energy technologies.' }],
      facts: { status: 'paused', org_name: 'ARPA-E', amount: '$10M', program_name: 'OPEN' },
      key_id: 'hedwig',
      key_name: 'Hedwig',
      at: '2026-10-01T00:00:00.000Z',
    },
  });
  assert.equal(brief.curator, true);
  assert.equal(brief.pill, 'Curator: Reject');
  assert.equal(brief.reason, 'The page describes a research office, not an open grant.');
  assert.equal(brief.call, 'check');
  assert.equal(brief.sources[0].domain, 'arpa-e.energy.gov');
  assert.deepEqual(brief.sources[0].quotes, ['ARPA-E advances high-potential energy technologies.']);
  const facts = Object.fromEntries(brief.facts.map((fact) => [fact.label, fact]));
  assert.equal(facts.Status.value, 'Paused');
  assert.equal(facts.Status.corrected, true);
  assert.equal(facts.Org.value, 'ARPA-E');
  assert.equal(facts.Org.corrected, true);
  assert.equal(facts.Amount.value, '$10M');
  assert.equal(facts.Amount.corrected, true);
  assert.equal(facts.Program.value, 'OPEN');
  assert.equal(facts.Program.corrected, true);
  assert.equal(facts.Website.corrected, undefined);
  assert.equal(facts.Name.corrected, undefined);
});

test('an unchanged curator fact is not marked corrected', () => {
  const brief = reviewBrief({
    ...arpa,
    curator_review: {
      verdict: 'needs_owner',
      reason: 'Confirm the office is in scope.',
      sources: [{ url: 'https://arpa-e.energy.gov/', quote: 'Energy technology programs.' }],
      facts: { status: 'active' },
      key_id: 'hedwig',
      key_name: 'Hedwig',
      at: '2026-10-01T00:00:00.000Z',
    },
  });
  assert.equal(brief.pill, 'Curator: Needs owner');
  const status = brief.facts.find((fact) => fact.label === 'Status');
  assert.equal(status.value, 'Active');
  assert.equal(status.corrected, undefined);
});

test('an org merge asks for a check and does not pretend files will change', () => {
  const brief = reviewBrief({
    type: 'merge_orgs',
    org: 'arpa-e',
    title: 'Are arpa-e and arpae the same org?',
    proposed_change: { a: 'arpa-e', b: 'arpae', domain: 'arpa-e.energy.gov' },
  });
  assert.equal(brief.call, 'check');
  assert.equal(brief.title, 'Merge arpa-e and arpae');
  assert.match(brief.reason, /does not change files/);
  assert.equal(proposerLabel({ title: 'Wire item from the miner' }), 'Wire');
});

test('the public header links Desk to the desk login', () => {
  const desk = PRIMARY_NAV.find((item) => item.href === '/admin/desk');
  assert.ok(desk);
  assert.equal(desk.label, 'Desk');
  assert.equal(PRIMARY_NAV.filter((item) => item.href === '/admin/desk').length, 1);
});
