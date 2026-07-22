import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
        {
          id: 'p00002',
          type: 'deadline_change',
          org: 'example',
          title: 'Interrupted apply',
          summary: 'Example',
          lane: 'fact',
          state: 'applying',
          created_at: '2026-07-14T00:00:00.000Z',
          applying_at: '2026-07-14T00:01:00.000Z',
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
  const recovered = await store.getProposal('p00002');
  assert.equal(recovered.state, 'applying');
  assert.match(recovered.validation.reason, /reconcile the durable ledger/);

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

test('prepared registry writes refuse live drift and commits exclude unrelated staged files', async (t) => {
  const originalCwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'grants-watch-committer-'));
  process.chdir(root);
  t.after(() => {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  });

  const git = (...args) =>
    execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  mkdirSync(join(root, 'registry'), { recursive: true });
  writeFileSync(join(root, 'registry', 'target.yaml'), 'value: old\n');
  writeFileSync(join(root, 'registry', 'other.yaml'), 'value: untouched\n');
  git('init', '-q');
  git('config', 'user.email', 'tests@example.invalid');
  git('config', 'user.name', 'Desk tests');
  git('add', 'registry');
  git('commit', '-qm', 'fixture');

  const committer = await import(`../src/lib/committer.ts?committer-safety=${Date.now()}`);
  const target = join(root, 'registry', 'target.yaml');
  const prepared = {
    changes: [
      {
        path: 'registry/target.yaml',
        content: 'value: proposed\n',
        op: 'update',
        content_before: 'value: old\n',
        content_after: 'value: proposed\n',
      },
    ],
    notes: [],
  };

  writeFileSync(join(root, 'registry', 'blocked'), 'not a directory\n');
  const partial = {
    changes: [
      ...prepared.changes,
      {
        path: 'registry/blocked/child.yaml',
        content: 'value: unreachable\n',
        op: 'create',
        content_before: null,
        content_after: 'value: unreachable\n',
      },
    ],
    notes: [],
  };
  const partialError = assert.throws(() => committer.writePreparedChanges(partial), /rolled back/);
  assert.equal(committer.registryMayHaveChanged(partialError), false);
  assert.equal(readFileSync(target, 'utf8'), 'value: old\n');
  rmSync(join(root, 'registry', 'blocked'));

  writeFileSync(target, 'value: hand-edit\n');
  git('add', 'registry/target.yaml');
  assert.throws(() => committer.assertCleanGitPaths(prepared.changes), /owner edits/);
  git('restore', '--staged', 'registry/target.yaml');
  assert.throws(() => committer.writePreparedChanges(prepared), /changed after preparation/);
  assert.equal(readFileSync(target, 'utf8'), 'value: hand-edit\n');

  writeFileSync(target, 'value: proposed\n');
  writeFileSync(join(root, 'registry', 'new.yaml'), 'value: created\n');
  writeFileSync(join(root, 'registry', 'other.yaml'), 'value: staged-only\n');
  git('add', 'registry/other.yaml');
  const sha = await committer.commitChange(['registry/target.yaml', 'registry/new.yaml'], 'scoped Desk commit');
  assert.ok(sha);
  assert.equal(git('show', 'HEAD:registry/target.yaml'), 'value: proposed');
  assert.equal(git('show', 'HEAD:registry/new.yaml'), 'value: created');
  assert.equal(git('show', 'HEAD:registry/other.yaml'), 'value: untouched');
  assert.equal(readFileSync(join(root, 'registry', 'other.yaml'), 'utf8'), 'value: staged-only\n');
});

test('no-git approval intent fails closed without Postgres', async (t) => {
  const original = process.env.GRANTS_WATCH_NO_GIT;
  process.env.GRANTS_WATCH_NO_GIT = '1';
  delete process.env.DATABASE_URL;
  t.after(() => {
    if (original === undefined) delete process.env.GRANTS_WATCH_NO_GIT;
    else process.env.GRANTS_WATCH_NO_GIT = original;
  });
  const store = await import(`../src/lib/desk-store.ts?no-git-guard=${Date.now()}`);
  await assert.rejects(
    store.recordAppliedChanges(
      {
        proposal_id: 'p-guard',
        files: [
          {
            path: 'registry/orgs/example.yaml',
            content_before_hash: null,
            content_after: 'id: example\n',
          },
        ],
        message: 'guard',
      },
      'prepared'
    ),
    /requires DATABASE_URL/
  );
});
