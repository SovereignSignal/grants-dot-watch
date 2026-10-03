// Pure classification for boot replay. The Postgres suite covers the outbox
// write; this one runs in CI without TEST_DATABASE_URL, which is where the
// superseded-approval decision has to stay red if it regresses.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ledgerRowSuperseded, registryPrSuperseded } from '../src/lib/boot-replay.ts';

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
