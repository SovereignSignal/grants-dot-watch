import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildNewProgramSourceFields } from '../src/lib/ingest-policy.ts';
import { neverAutoReasonFor } from '../src/lib/machine-approval-policy.ts';

test('new programs require owner review', () => {
  assert.equal(neverAutoReasonFor('new_program'), 'new programs require owner review');
});

test('organization websites never become program application URLs', () => {
  const fields = buildNewProgramSourceFields({
    orgWebsite: 'https://example.org',
    applicationUrl: null,
    evidenceUrl: 'https://news.example/report',
    deadline: null,
    amount: null,
  });

  assert.equal(fields.apply_url, undefined);
});

test('dated opportunities are current calls, not rolling rounds', () => {
  const fields = buildNewProgramSourceFields({
    orgWebsite: 'https://example.org',
    applicationUrl: null,
    evidenceUrl: 'https://example.org/call',
    deadline: '2026-09-30',
    amount: '$100,000',
  });

  assert.equal(fields.apply_url, 'https://example.org/call');
  assert.deepEqual(fields.rounds, [
    {
      name: 'Current call',
      status: 'open',
      closes: '2026-09-30',
      source: 'https://example.org/call',
      size: '$100,000',
    },
  ]);
});

test('a proposal can only be claimed once and stale validation cannot restore it', async (t) => {
  const originalCwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'grants-watch-desk-'));
  delete process.env.DATABASE_URL;
  process.chdir(root);
  t.after(() => {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  });

  mkdirSync(join(root, '.data'), { recursive: true });
  writeFileSync(
    join(root, '.data', 'desk.json'),
    JSON.stringify({
      proposals: [
        {
          id: 'p00001',
          type: 'deadline_change',
          org: 'example',
          title: 'Example deadline',
          summary: 'Example',
          lane: 'fact',
          state: 'pending',
          created_at: '2026-07-14T00:00:00.000Z',
        },
      ],
      verdicts: [],
    }),
    'utf8'
  );

  const store = await import('../src/lib/desk-store.ts?write-safety');
  const claims = await Promise.all([store.claimProposal('p00001'), store.claimProposal('p00001')]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await store.getProposal('p00001')).state, 'applying');

  await store.setProposalValidation('p00001', {
    checks: [{ name: 'late-result', pass: false }],
    reason: 'late validation',
    checked_at: '2026-07-14T00:01:00.000Z',
  });
  const applying = await store.getProposal('p00001');
  assert.equal(applying.state, 'applying');
  assert.equal(applying.validation, undefined);

  await store.recordVerdict('p00001', 'approved', { from: 'applying' });
  assert.equal((await store.getProposal('p00001')).state, 'approved');
});
