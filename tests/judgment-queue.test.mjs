import assert from 'node:assert/strict';
import test from 'node:test';

import { curatorVerdictOf, judgmentDeadline, sortJudgmentQueue } from '../src/app/admin/desk/judgment-queue.ts';

test('judgment queue sorts the soonest deadline first and leaves undated items last', () => {
  const sorted = sortJudgmentQueue([
    { id: 'p3', title: 'Zebra', proposed_change: {} },
    {
      id: 'p2',
      title: 'Later',
      proposed_change: { 'programs/later.yaml': { rounds: [{ closes: '2026-12-01' }] } },
    },
    {
      id: 'p1',
      title: 'Soon',
      proposed_change: { 'programs/soon.yaml': { rounds: [{ closes: '2026-12-20' }] } },
      curator_review: {
        verdict: 'reject',
        reason: 'The page says September.',
        sources: [{ url: 'https://example.org', quote: 'Closed in September.' }],
        facts: { deadline: '2026-09-15' },
        key_id: 'hedwig',
        key_name: 'Hedwig',
        at: '2026-10-01T00:00:00.000Z',
      },
    },
    { id: 'p4', title: 'Alpha', proposed_change: {} },
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ['p1', 'p2', 'p4', 'p3']);
  assert.equal(judgmentDeadline(sorted[0]), '2026-09-15');
  assert.equal(curatorVerdictOf(sorted[0]), 'reject');
  assert.equal(curatorVerdictOf(sorted[2]), 'unreviewed');
});
