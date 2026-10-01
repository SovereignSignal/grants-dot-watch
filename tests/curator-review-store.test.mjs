import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const review = {
  verdict: 'reject',
  reason: 'Not a grant program.',
  sources: [{ url: 'https://example.org/grants', quote: 'Example Foundation awards grants.' }],
  facts: { status: 'paused' },
  key_id: 'hedwig',
  key_name: 'Hedwig',
  at: '2026-10-01T00:00:00.000Z',
};

test('a curator review is stored on the proposal and does not change its state', async (t) => {
  const originalCwd = process.cwd();
  const originalUrl = process.env.DATABASE_URL;
  const root = mkdtempSync(join(tmpdir(), 'grants-watch-review-'));
  process.chdir(root);
  delete process.env.DATABASE_URL;
  t.after(() => {
    process.chdir(originalCwd);
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    rmSync(root, { recursive: true, force: true });
  });

  mkdirSync(join(root, '.data'), { recursive: true });
  writeFileSync(join(root, '.data', 'desk.json'), JSON.stringify({
    proposals: [
      {
        id: 'p00001',
        type: 'new_org',
        org: null,
        title: 'Example',
        summary: 'Example',
        lane: 'judgment',
        state: 'pending',
        created_at: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'p00002',
        type: 'new_org',
        org: null,
        title: 'Decided',
        summary: 'Decided',
        lane: 'judgment',
        state: 'approved',
        created_at: '2026-10-01T00:00:00.000Z',
      },
    ],
    verdicts: [],
  }));

  const store = await import(`../src/lib/desk-store.ts?curator-review=${Date.now()}`);
  const first = await store.saveCuratorReview('p00001', review);
  assert.equal(first.status, 'saved');
  assert.equal(first.proposal.state, 'pending');
  const second = await store.saveCuratorReview('p00001', { ...review, verdict: 'needs_owner', at: '2026-10-01T01:00:00.000Z' });
  assert.equal(second.status, 'saved');
  const stored = await store.getProposal('p00001');
  assert.equal(stored.state, 'pending');
  assert.equal(stored.curator_review.verdict, 'needs_owner');
  assert.equal(stored.curator_review_history.length, 2);
  assert.equal(stored.curator_review_history[0].verdict, 'reject');
  assert.equal((await store.saveCuratorReview('p00009', review)).status, 'missing');
  assert.equal((await store.saveCuratorReview('p00002', review)).status, 'decided');
  assert.equal((await store.getProposal('p00002')).state, 'approved');
  assert.equal((await store.getProposal('p00002')).curator_review, undefined);
});
