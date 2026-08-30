import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

function run(root, today, extraArgs = []) {
  return execFileSync(process.execPath, ['scripts/close-stale-rounds.mjs', '--json', ...extraArgs], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, REGISTRY_ROOT: root, VALIDATION_TODAY: today },
  });
}

test('close-stale-rounds dry-run reports past live rounds and write closes them in place', () => {
  const root = mkdtempSync(join(tmpdir(), 'close-stale-'));
  mkdirSync(join(root, 'programs'));
  const file = join(root, 'programs', 'example-grants.yaml');
  writeFileSync(file, `id: example-grants
name: Example Grants
org: example
status: active
mechanism: grants
summary: A fixture used to exercise automatic close of a past live round.
rounds:
  - name: Current call
    status: open
    closes: 2026-08-28
    source: https://example.org/apply
  - name: Next call
    status: announced
    closes: 2026-11-03
    source: https://example.org/apply
sources:
  - https://example.org/apply
`);

  const dry = JSON.parse(run(root, '2026-08-29'));
  assert.equal(dry.write, false);
  assert.equal(dry.changes.length, 1);
  assert.equal(dry.changes[0].round, 'Current call');
  assert.equal(YAML.parse(readFileSync(file, 'utf8')).rounds[0].status, 'open');

  const written = JSON.parse(run(root, '2026-08-29', ['--write']));
  assert.equal(written.write, true);
  assert.equal(written.changes.length, 1);
  const doc = YAML.parse(readFileSync(file, 'utf8'));
  assert.equal(doc.rounds[0].status, 'closed');
  assert.equal(doc.rounds[1].status, 'announced');
  assert.match(readFileSync(file, 'utf8'), /name: Current call\n    status: closed/);
});
