// Pure classification for boot replay. The Postgres suite covers the outbox
// write; this one runs in CI without TEST_DATABASE_URL, which is where the
// superseded-approval decision has to stay red if it regresses.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { applyLedgerRow, ledgerRowSuperseded, registryPrSuperseded } from '../src/lib/boot-replay.ts';
import { APPLY_URL_BY_PATH } from '../src/lib/ledger-apply-urls.mjs';

const OPENAI = 'registry/programs/openai-ai-and-teen-development-research-grant-program.yaml';
const IVADO = 'registry/programs/ivado-call-for-participation-funding-for-ai-projects-in-neur.yaml';
const ROCKET = 'registry/programs/rocket-pool-gmc-grants.yaml';

const file = (path, contentAfter, before = 'base') => ({
  path,
  content_before_hash: before,
  content_after: contentAfter,
});

test('a later approval already on disk supersedes the earlier ledger row', () => {
  // Registry PR #31 left the canonical file at the later approval's bytes.
  // The earlier row must not be replayed over that file, and it is not a
  // conflict: p01550 (and the same shape for p01551 / p01553) already won.
  const earlier = [file(OPENAI, 'placeholder summary\n', null)];
  const later = [file(OPENAI, 'sourced summary\n', 'hash-of-placeholder')];
  const read = (path) => (path === OPENAI ? 'sourced summary\n' : null);

  assert.equal(ledgerRowSuperseded(earlier, read, [later]), true);
  assert.equal(ledgerRowSuperseded(later, read, []), false);
});

test('three superseded approvals are recognized per path and an unrelated divergence is not', () => {
  const canonical = {
    [OPENAI]: 'openai canonical\n',
    [IVADO]: 'ivado canonical\n',
    [ROCKET]: 'rocket canonical\n',
  };
  const earlier = [
    file(OPENAI, 'openai placeholder\n', null),
    file(IVADO, 'ivado placeholder\n', null),
    file(ROCKET, 'rocket with duplicate round\n', 'previous-rocket'),
  ];
  const later = [
    [file(OPENAI, canonical[OPENAI], 'hash-openai')],
    [file(IVADO, canonical[IVADO], 'hash-ivado')],
    [file(ROCKET, canonical[ROCKET], 'hash-rocket')],
  ];
  const read = (path) => canonical[path] ?? null;

  for (const row of earlier) {
    assert.equal(ledgerRowSuperseded([row], read, later), true);
  }
  for (const row of later) {
    assert.equal(ledgerRowSuperseded(row, read, []), false);
  }

  // A hand edit that matches no later approval is still a conflict. Boot
  // replay must keep refusing that, or a real divergence would look healthy.
  const diverged = [file('registry/orgs/acme.yaml', 'v1\n', 'hash-v0')];
  const chained = [file('registry/orgs/acme.yaml', 'v2\n', 'hash-v1')];
  assert.equal(ledgerRowSuperseded(diverged, () => 'something else entirely\n', [chained]), false);
});

test('registry PR #31 leftovers are superseded even when the canonical bytes differ', () => {
  // The committed program files were written by hand, so they are not the
  // committer's content_after. p01426, p01438, and p01505 are the refusals;
  // p01550, p01551, and p01553 are the approvals deferred behind them.
  const canonical = 'sourced summary, not the ledger bytes\n';
  const files = [file(OPENAI, 'ledger bytes\n', null)];
  const read = () => canonical;
  for (const id of ['p01426', 'p01438', 'p01505', 'p01550', 'p01551', 'p01553']) {
    assert.equal(registryPrSuperseded(id, files, read), true, id);
  }
  assert.equal(registryPrSuperseded('p00001', files, read), false);
  assert.equal(registryPrSuperseded('p01550', [file(OPENAI, canonical, null)], read), false);
});

const NSF_HUBS = 'registry/programs/nsf-state-and-regional-ai-infrastructure-hubs-nsf-26-513.yaml';
const NSF_URL = APPLY_URL_BY_PATH[NSF_HUBS];
const NSF_LEDGER = 'status: active\nsummary: Ledger snapshot long enough to stand in for the program.\n';
const NSF_WITH_URL = `status: active\napply_url: ${NSF_URL}\nsummary: Ledger snapshot long enough to stand in for the program.\n`;

test('a blessed NSF apply link satisfies the ledger snapshot and is not stripped', () => {
  const root = mkdtempSync(join(tmpdir(), 'grants-watch-boot-'));
  try {
    mkdirSync(join(root, 'registry', 'programs'), { recursive: true });
    writeFileSync(join(root, NSF_HUBS), NSF_WITH_URL);
    const wrote = applyLedgerRow(root, [file(NSF_HUBS, NSF_LEDGER, 'hash-of-base')]);
    assert.deepEqual(wrote, []);
    assert.equal(readFileSync(join(root, NSF_HUBS), 'utf8'), NSF_WITH_URL);

    const earlier = [file(NSF_HUBS, 'status: unknown\nsummary: Earlier snapshot long enough to stand in.\n', 'hash-of-git')];
    const later = [file(NSF_HUBS, NSF_LEDGER, 'hash-of-earlier')];
    assert.equal(ledgerRowSuperseded(earlier, () => NSF_WITH_URL, [later]), true);
    assert.equal(ledgerRowSuperseded(later, () => NSF_WITH_URL, []), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an edit besides the blessed apply line is still a conflict', () => {
  const diverged = `status: active\napply_url: ${NSF_URL}\nsummary: Different summary long enough to be a real edit.\n`;
  const earlier = [file(NSF_HUBS, 'status: unknown\nsummary: Earlier snapshot long enough to stand in.\n', 'hash-of-git')];
  const later = [file(NSF_HUBS, NSF_LEDGER, 'hash-of-earlier')];
  assert.equal(ledgerRowSuperseded(earlier, () => diverged, [later]), false);

  const root = mkdtempSync(join(tmpdir(), 'grants-watch-boot-'));
  try {
    mkdirSync(join(root, 'registry', 'programs'), { recursive: true });
    writeFileSync(join(root, NSF_HUBS), diverged);
    assert.throws(
      () => applyLedgerRow(root, [file(NSF_HUBS, NSF_LEDGER, 'hash-of-base')]),
      /canonical content changed since proposal apply/
    );
    assert.equal(readFileSync(join(root, NSF_HUBS), 'utf8'), diverged);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
