import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { APPLY_URL_BY_PATH } from '../src/lib/ledger-apply-urls.mjs';
import { applyRow } from '../scripts/sync-desk-commits.mjs';

const SYNC_SCRIPT = fileURLToPath(new URL('../scripts/sync-desk-commits.mjs', import.meta.url));

function git(repo, ...args) {
  return execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'grants-watch-sync-'));
  mkdirSync(join(repo, 'registry'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'tests@example.invalid');
  git(repo, 'config', 'user.name', 'Desk tests');
  writeFileSync(join(repo, 'registry', 'target.yaml'), 'value: old\n');
  writeFileSync(join(repo, 'registry', 'other.yaml'), 'value: untouched\n');
  git(repo, 'add', 'registry');
  git(repo, 'commit', '-qm', 'fixture');
  return repo;
}

test('ledger replay uses base hashes and excludes unrelated staged changes', () => {
  const repo = fixture();
  try {
    writeFileSync(join(repo, 'registry', 'other.yaml'), 'value: staged-only\n');
    git(repo, 'add', 'registry/other.yaml');

    const result = applyRow(
      repo,
      {
        id: 1,
        message: 'apply target',
        files: [
          {
            path: 'registry/target.yaml',
            content_before_hash: hash('value: old\n'),
            content_after: 'value: new\n',
          },
        ],
      },
      false
    );

    assert.ok(result.sha);
    assert.equal(git(repo, 'show', 'HEAD:registry/target.yaml'), 'value: new');
    assert.equal(git(repo, 'show', 'HEAD:registry/other.yaml'), 'value: untouched');
    assert.equal(readFileSync(join(repo, 'registry', 'other.yaml'), 'utf8'), 'value: staged-only\n');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('ledger replay refuses to overwrite a divergent canonical file', () => {
  const repo = fixture();
  try {
    writeFileSync(join(repo, 'registry', 'target.yaml'), 'value: hand-edit\n');
    assert.throws(
      () =>
        applyRow(
          repo,
          {
            id: 2,
            files: [
              {
                path: 'registry/target.yaml',
                content_before_hash: hash('value: old\n'),
                content_after: 'value: proposed\n',
              },
            ],
          },
          false
        ),
      /refusing to overwrite/
    );
    assert.equal(readFileSync(join(repo, 'registry', 'target.yaml'), 'utf8'), 'value: hand-edit\n');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('ledger replay refuses exact-target staged edits without changing them', () => {
  const repo = fixture();
  try {
    writeFileSync(join(repo, 'registry', 'target.yaml'), 'value: staged-user-edit\n');
    git(repo, 'add', 'registry/target.yaml');

    assert.throws(
      () =>
        applyRow(
          repo,
          {
            id: 3,
            files: [
              {
                path: 'registry/target.yaml',
                content_before_hash: hash('value: old\n'),
                content_after: 'value: proposed\n',
              },
            ],
          },
          false
        ),
      /exact target has staged changes/
    );
    assert.equal(readFileSync(join(repo, 'registry', 'target.yaml'), 'utf8'), 'value: staged-user-edit\n');
    assert.equal(git(repo, 'show', ':registry/target.yaml'), 'value: staged-user-edit');
    assert.equal(git(repo, 'show', 'HEAD:registry/target.yaml'), 'value: old');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('ledger replay refuses HEAD drift even when the worktree resembles the captured base', () => {
  const repo = fixture();
  try {
    writeFileSync(join(repo, 'registry', 'target.yaml'), 'value: newer-head\n');
    git(repo, 'add', 'registry/target.yaml');
    git(repo, 'commit', '-qm', 'advance target');
    writeFileSync(join(repo, 'registry', 'target.yaml'), 'value: old\n');

    assert.throws(
      () =>
        applyRow(
          repo,
          {
            id: 4,
            files: [
              {
                path: 'registry/target.yaml',
                content_before_hash: hash('value: old\n'),
                content_after: 'value: proposed\n',
              },
            ],
          },
          false
        ),
      /HEAD changed since proposal apply/
    );
    assert.equal(readFileSync(join(repo, 'registry', 'target.yaml'), 'utf8'), 'value: old\n');
    assert.equal(git(repo, 'show', 'HEAD:registry/target.yaml'), 'value: newer-head');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('ledger replay commits a previously written but uncommitted snapshot', () => {
  const repo = fixture();
  try {
    writeFileSync(join(repo, 'registry', 'target.yaml'), 'value: proposed\n');
    const result = applyRow(
      repo,
      {
        id: 5,
        message: 'resume interrupted replay',
        files: [
          {
            path: 'registry/target.yaml',
            content_before_hash: hash('value: old\n'),
            content_after: 'value: proposed\n',
          },
        ],
      },
      false
    );
    assert.ok(result.sha);
    assert.equal(git(repo, 'show', 'HEAD:registry/target.yaml'), 'value: proposed');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('ledger replay resumes a byte-exact staged snapshot', () => {
  const repo = fixture();
  try {
    writeFileSync(join(repo, 'registry', 'target.yaml'), 'value: proposed\n');
    git(repo, 'add', 'registry/target.yaml');
    const result = applyRow(
      repo,
      {
        id: 6,
        message: 'resume interrupted staged replay',
        files: [
          {
            path: 'registry/target.yaml',
            content_before_hash: hash('value: old\n'),
            content_after: 'value: proposed\n',
          },
        ],
      },
      false
    );
    assert.ok(result.sha);
    assert.equal(git(repo, 'show', 'HEAD:registry/target.yaml'), 'value: proposed');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('sync CLI exits nonzero and omits the success summary when a row fails', () => {
  const repo = fixture();
  try {
    writeFileSync(join(repo, 'registry', 'target.yaml'), 'value: hand-edit\n');
    const ledger = join(repo, 'failed-row.jsonl');
    writeFileSync(
      ledger,
      `${JSON.stringify({
        state: 'ready',
        message: 'must fail',
        files: [
          {
            path: 'registry/target.yaml',
            content_before_hash: hash('value: old\n'),
            content_after: 'value: proposed\n',
          },
        ],
      })}\n`
    );

    const result = spawnSync(
      process.execPath,
      [SYNC_SCRIPT, '--from-jsonl', ledger, '--repo', repo],
      { encoding: 'utf8' }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAILED/);
    assert.match(result.stderr, /Incomplete:/);
    assert.doesNotMatch(result.stdout, /Done:/);
    assert.equal(readFileSync(join(repo, 'registry', 'target.yaml'), 'utf8'), 'value: hand-edit\n');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('deployment confirmation requires ledger bytes in deployed Git ancestry', async () => {
  const { verifyLedgerCommit, confirmDeployment } = await import('../scripts/sync-desk-commits.mjs');
  const repo=fixture();const originalFetch=globalThis.fetch;
  try {
    const previous=git(repo,'rev-parse','HEAD');
    const row={id:1,files:[{path:'registry/target.yaml',content_before_hash:hash('value: old\n'),content_after:'value: new\n'}]};
    row.sha=applyRow(repo,row,false).sha;
    assert.equal(verifyLedgerCommit(repo,row,previous),false);
    assert.equal(verifyLedgerCommit(repo,row,row.sha),true);
    assert.equal(verifyLedgerCommit(repo,{...row,files:[{...row.files[0],content_after:'tampered'}]},row.sha),false);
    const writes=[];const pool={query:async(sql,args)=>{writes.push([sql,args]);return {rowCount:1};}};
    globalThis.fetch=async()=>({ok:true,json:async()=>({commit:previous})});
    await confirmDeployment(repo,pool,[row],'https://example.org',false);assert.equal(writes.length,0);
    globalThis.fetch=async()=>({ok:true,json:async()=>({commit:row.sha})});
    await confirmDeployment(repo,pool,[row],'https://example.org',true);assert.equal(writes.length,0);
    await confirmDeployment(repo,pool,[row],'https://example.org',false);assert.equal(writes.length,1);
    assert.match(writes[0][0],/files = \$3::jsonb/);assert.equal(writes[0][1][1],row.sha);
    // A later approved revision legitimately supersedes the earlier file.
    const next={files:[{path:'registry/target.yaml',content_before_hash:hash('value: new\n'),content_after:'value: latest\n'}]};
    const newer=applyRow(repo,next,false).sha;assert.equal(verifyLedgerCommit(repo,row,newer),true);
    globalThis.fetch=async()=>({ok:true,json:async()=>({commit:newer})});
    await assert.rejects(confirmDeployment(repo,{query:async()=>({rowCount:0})},[row],'https://example.org',false),/changed during/);
  } finally {globalThis.fetch=originalFetch;rmSync(repo,{recursive:true,force:true});}
});

function chainedLedger(repo, rows) {
  const ledger = join(repo, 'chained.jsonl');
  writeFileSync(ledger, rows.map((row) => JSON.stringify({ state: 'ready', ...row })).join('\n') + '\n');
  return ledger;
}

function runSync(repo, ledger, ...extra) {
  return spawnSync(process.execPath, [SYNC_SCRIPT, '--from-jsonl', ledger, '--repo', repo, ...extra], {
    encoding: 'utf8',
  });
}

test('dry run simulates rows chained on the same file, and the real run agrees', () => {
  const repo = fixture();
  try {
    const ledger = chainedLedger(repo, [
      {
        message: 'first',
        files: [{ path: 'registry/target.yaml', content_before_hash: hash('value: old\n'), content_after: 'value: one\n' }],
      },
      {
        message: 'second',
        files: [
          { path: 'registry/target.yaml', content_before_hash: hash('value: one\n'), content_after: 'value: two\n' },
          { path: 'registry/other.yaml', content_before_hash: hash('value: untouched\n'), content_after: 'value: moved\n' },
        ],
      },
    ]);
    const head = git(repo, 'rev-parse', 'HEAD');

    const dry = runSync(repo, ledger, '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal((dry.stdout.match(/would commit/g) || []).length, 2);
    assert.match(dry.stdout, /Done:/);
    // The simulation moves nothing: HEAD, index and worktree stay as they were.
    assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
    assert.equal(readFileSync(join(repo, 'registry', 'target.yaml'), 'utf8'), 'value: old\n');
    assert.equal(git(repo, 'status', '--porcelain', '--', 'registry'), '');

    const real = runSync(repo, ledger);
    assert.equal(real.status, 0, real.stderr);
    assert.equal(git(repo, 'show', 'HEAD:registry/target.yaml'), 'value: two');
    assert.equal(git(repo, 'show', 'HEAD:registry/other.yaml'), 'value: moved');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('dry run still fails a genuinely stale row in a chain', () => {
  const repo = fixture();
  try {
    const ledger = chainedLedger(repo, [
      {
        message: 'first',
        files: [{ path: 'registry/target.yaml', content_before_hash: hash('value: old\n'), content_after: 'value: one\n' }],
      },
      {
        // Based on a version neither HEAD nor the simulated first row produces.
        message: 'stale',
        files: [{ path: 'registry/target.yaml', content_before_hash: hash('value: elsewhere\n'), content_after: 'value: two\n' }],
      },
    ]);

    const dry = runSync(repo, ledger, '--dry-run');
    assert.equal(dry.status, 1);
    assert.match(dry.stdout, /row L1: would commit 1 file/);
    assert.match(dry.stderr, /row L2: FAILED .*HEAD changed since proposal apply/);
    assert.doesNotMatch(dry.stdout, /Done:/);
    assert.equal(readFileSync(join(repo, 'registry', 'target.yaml'), 'utf8'), 'value: old\n');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

const NSF_HUBS = 'registry/programs/nsf-state-and-regional-ai-infrastructure-hubs-nsf-26-513.yaml';
const NSF_DCL = 'registry/programs/nsf-dcl-unleashing-a-new-age-of-ai-enabled-scientific-discov.yaml';

test('NSF apply links are a follow-up commit and the ledger base hash still matches', () => {
  const repo = fixture();
  try {
    mkdirSync(join(repo, 'registry', 'programs'), { recursive: true });
    const original = [
      'id: nsf-state-and-regional-ai-infrastructure-hubs-nsf-26-513',
      'name: NSF State and Regional AI Infrastructure Hubs (NSF 26-513)',
      'status: unknown',
      'summary: Original git snapshot long enough for the base hash.',
      'rounds: []',
      '',
    ].join('\n');
    const hubsAfter = original.replace('status: unknown', 'status: active').replace('rounds: []', 'rounds:\n  - name: Full proposal\n    status: open\n');
    const dclAfter = [
      'id: nsf-dcl-unleashing-a-new-age-of-ai-enabled-scientific-discov',
      'name: NSF DCL',
      'status: active',
      'summary: DCL snapshot long enough to be a created program file.',
      'rounds: []',
      '',
    ].join('\n');
    writeFileSync(join(repo, NSF_HUBS), original);
    git(repo, 'add', NSF_HUBS);
    git(repo, 'commit', '-qm', 'nsf base');

    const ledger = chainedLedger(repo, [
      {
        id: 810,
        message: 'publish hubs',
        files: [{ path: NSF_HUBS, content_before_hash: hash(original), content_after: hubsAfter }],
      },
      {
        id: 806,
        message: 'publish dcl',
        files: [{ path: NSF_DCL, content_before_hash: null, content_after: dclAfter }],
      },
    ]);

    const dry = runSync(repo, ledger, '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /would record apply_url/);
    assert.equal(readFileSync(join(repo, NSF_HUBS), 'utf8'), original);
    assert.equal(exists(repo, NSF_DCL), false);

    const real = runSync(repo, ledger);
    assert.equal(real.status, 0, real.stderr);
    assert.match(real.stdout, /recorded apply_url/);
    const head = git(repo, 'rev-parse', 'HEAD');
    const ledgerHead = git(repo, 'rev-parse', 'HEAD~1');
    const show = (spec) => execFileSync('git', ['show', spec], { cwd: repo, stdio: 'pipe' }).toString();
    assert.equal(show(`${ledgerHead}:${NSF_HUBS}`), hubsAfter);
    assert.equal(show(`${ledgerHead}:${NSF_DCL}`), dclAfter);
    assert.equal(show(`HEAD~2:${NSF_HUBS}`), hubsAfter);
    assert.equal(show(`HEAD~3:${NSF_HUBS}`), original);
    assert.match(show(`${head}:${NSF_HUBS}`), new RegExp(`apply_url: ${escapeRegExp(APPLY_URL_BY_PATH[NSF_HUBS])}`));
    assert.match(show(`${head}:${NSF_DCL}`), new RegExp(`apply_url: ${escapeRegExp(APPLY_URL_BY_PATH[NSF_DCL])}`));
    assert.doesNotMatch(hubsAfter, /apply_url:/);
    assert.match(real.stdout, /Done: 3 commits/);

    const replayed = join(repo, 'replayed.jsonl');
    writeFileSync(
      replayed,
      [
        JSON.stringify({ id: 810, state: 'ready', sha: git(repo, 'rev-parse', 'HEAD~2'), message: 'publish hubs', files: [{ path: NSF_HUBS, content_before_hash: hash(original), content_after: hubsAfter }] }),
        JSON.stringify({ id: 806, state: 'ready', sha: ledgerHead, message: 'publish dcl', files: [{ path: NSF_DCL, content_before_hash: null, content_after: dclAfter }] }),
      ].join('\n') + '\n'
    );
    const again = runSync(repo, replayed);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /ledger content is committed/);
    assert.doesNotMatch(again.stdout, /recorded apply_url/);
    assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
    assert.match(readFileSync(join(repo, NSF_HUBS), 'utf8'), /apply_url:/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

function exists(repo, path) {
  try {
    readFileSync(join(repo, path));
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
