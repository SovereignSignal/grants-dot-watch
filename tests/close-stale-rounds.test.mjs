import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

test('close-stale-rounds leaves files an unsynced ledger row targets and exits 2', () => {
  const root = mkdtempSync(join(tmpdir(), 'close-stale-'));
  mkdirSync(join(root, 'programs'));
  const program = (id) => `id: ${id}
name: ${id}
org: example
status: active
mechanism: grants
summary: A fixture used to exercise held stale rounds.
rounds:
  - name: Current call
    status: open
    closes: 2026-08-28
    source: https://example.org/apply
sources:
  - https://example.org/apply
`;
  const held = join(root, 'programs', 'held-grants.yaml');
  const free = join(root, 'programs', 'free-grants.yaml');
  writeFileSync(held, program('held-grants'));
  writeFileSync(free, program('free-grants'));
  const ledgerPaths = join(root, 'ledger-paths.txt');
  writeFileSync(ledgerPaths, 'registry/programs/held-grants.yaml\nregistry/funding-control.json\n');

  const result = spawnSync(
    process.execPath,
    ['scripts/close-stale-rounds.mjs', '--write', '--json', '--ledger-paths', ledgerPaths],
    { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, REGISTRY_ROOT: root, VALIDATION_TODAY: '2026-08-29' } }
  );
  assert.equal(result.status, 2, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.deepEqual(out.changes.map((change) => change.id), ['free-grants']);
  assert.deepEqual(out.held.map((change) => change.id), ['held-grants']);
  assert.match(result.stderr, /unsynced Desk ledger row/);
  assert.equal(YAML.parse(readFileSync(free, 'utf8')).rounds[0].status, 'closed');
  assert.equal(readFileSync(held, 'utf8'), program('held-grants'));
});

const DEADLINE_ROUNDS = [
  { name: 'Date only', status: 'open', closes: '2026-10-23' },
  { name: 'Zoned exact', status: 'open', closes: '2026-11-03', closes_at: '2026-11-03T12:00:00+01:00' },
  { name: 'Unzoned exact', status: 'announced', closes: '2026-11-04', closes_at: '2026-11-04T12:00:00' },
  { name: 'Month only', status: 'open', closes: '2026-11' },
  { name: 'Undated', status: 'open' },
  { name: 'Already closed', status: 'closed', closes: '2026-01-15' },
];

function deadlineRegistry() {
  const root = mkdtempSync(join(tmpdir(), 'close-deadline-'));
  for (const directory of ['systems', 'orgs', 'programs', 'awards']) mkdirSync(join(root, directory));
  writeFileSync(join(root, 'systems', 'test.yaml'), YAML.stringify({
    id: 'test',
    name: 'Test System',
    kind: 'funding-domain',
    wires: ['oss'],
    summary: 'A funding-domain system used only to exercise round deadline rules.',
    sources: ['https://example.org/system'],
  }));
  writeFileSync(join(root, 'orgs', 'funder.yaml'), YAML.stringify({
    id: 'funder',
    name: 'Example Funder',
    roles: ['funder'],
    org_type: 'foundation',
    status: 'active',
    website: 'https://example.org/',
    profile: 'Example Funder publishes calls with several deadline forms, used only for validator fixtures.',
    sources: ['https://example.org/'],
  }));
  const file = join(root, 'programs', 'deadline-calls.yaml');
  writeFileSync(file, YAML.stringify({
    id: 'deadline-calls',
    name: 'Deadline Calls',
    org: 'funder',
    systems: ['test'],
    wires: ['oss'],
    status: 'active',
    mechanism: 'grants',
    apply_url: 'https://example.org/apply',
    summary: 'A fixture program whose rounds cover each supported deadline form.',
    rounds: DEADLINE_ROUNDS.map((round) => ({ ...round, source: 'https://example.org/apply' })),
    sources: ['https://example.org/apply'],
  }));
  return { root, file };
}

function closerAt(root, now, extraArgs = []) {
  const env = { ...process.env, REGISTRY_ROOT: root, VALIDATION_NOW: now };
  delete env.VALIDATION_TODAY;
  const result = spawnSync(process.execPath, ['scripts/close-stale-rounds.mjs', '--json', ...extraArgs], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
  });
  return JSON.parse(result.stdout).changes.map((change) => change.round).sort();
}

function validatorAt(root, now) {
  const env = { ...process.env, REGISTRY_ROOT: root, VALIDATION_NOW: now };
  delete env.VALIDATION_TODAY;
  const result = spawnSync(process.execPath, ['scripts/validate-registry.mjs'], { cwd: process.cwd(), encoding: 'utf8', env });
  return [...`${result.stdout}${result.stderr}`.matchAll(/round "([^"]+)" is \w+ with past close/g)].map((m) => m[1]).sort();
}

test('a date-only close lasts to the end of that day Anywhere on Earth plus 6 hours', () => {
  const { root } = deadlineRegistry();
  assert.deepEqual(closerAt(root, '2026-10-24T07:30:00Z'), []);
  assert.deepEqual(closerAt(root, '2026-10-24T18:00:00Z'), []);
  assert.deepEqual(closerAt(root, '2026-10-24T18:00:01Z'), ['Date only']);
});

test('closes_at is honored in its stated zone, and an unzoned time is read as AoE', () => {
  const { root } = deadlineRegistry();
  assert.deepEqual(closerAt(root, '2026-11-03T16:59:00Z'), ['Date only']);
  assert.deepEqual(closerAt(root, '2026-11-03T17:00:01Z'), ['Date only', 'Zoned exact']);
  assert.deepEqual(closerAt(root, '2026-11-05T05:59:00Z'), ['Date only', 'Zoned exact']);
  assert.deepEqual(closerAt(root, '2026-11-05T06:00:01Z'), ['Date only', 'Unzoned exact', 'Zoned exact']);
});

test('a month-only close lasts to the end of the month AoE plus 6 hours', () => {
  const { root } = deadlineRegistry();
  assert.equal(closerAt(root, '2026-12-01T17:59:00Z').includes('Month only'), false);
  assert.equal(closerAt(root, '2026-12-01T18:00:01Z').includes('Month only'), true);
});

test('closing sets status to closed and never removes rounds or fields', () => {
  const { root, file } = deadlineRegistry();
  const before = YAML.parse(readFileSync(file, 'utf8'));
  closerAt(root, '2027-01-01T00:00:00Z', ['--write']);
  const after = YAML.parse(readFileSync(file, 'utf8'));
  assert.equal(after.rounds.length, before.rounds.length);
  assert.deepEqual(
    after.rounds.map((round) => round.status),
    ['closed', 'closed', 'closed', 'closed', 'open', 'closed']
  );
  const withoutStatus = (round) => ({ ...round, status: undefined });
  assert.deepEqual(after.rounds.map(withoutStatus), before.rounds.map(withoutStatus));
  assert.equal(after.apply_url, before.apply_url);
});

test('the validator fails exactly the rounds the closer would close', () => {
  const { root } = deadlineRegistry();
  for (const now of [
    '2026-10-24T17:59:59Z',
    '2026-10-24T18:00:01Z',
    '2026-11-03T17:00:01Z',
    '2026-11-05T06:00:01Z',
    '2026-12-01T18:00:01Z',
  ]) {
    assert.deepEqual(validatorAt(root, now), closerAt(root, now), now);
  }
});

test('VALIDATION_TODAY still replays a whole product day', () => {
  const { root } = deadlineRegistry();
  const env = { ...process.env, REGISTRY_ROOT: root, VALIDATION_TODAY: '2026-10-24' };
  delete env.VALIDATION_NOW;
  const out = JSON.parse(execFileSync(process.execPath, ['scripts/close-stale-rounds.mjs', '--json'], { encoding: 'utf8', env }));
  assert.deepEqual(out.changes.map((change) => change.round), ['Date only']);
  env.VALIDATION_TODAY = '2026-10-23';
  const earlier = JSON.parse(execFileSync(process.execPath, ['scripts/close-stale-rounds.mjs', '--json'], { encoding: 'utf8', env }));
  assert.deepEqual(earlier.changes, []);
});

test('the closer and validator carry the same deadline rule', () => {
  const block = (path) => readFileSync(path, 'utf8').match(/^const DEADLINE_GRACE_MS[\s\S]*?^const nowMs = .*$/m)?.[0];
  const validator = block('scripts/validate-registry.mjs');
  assert.ok(validator);
  assert.equal(block('scripts/close-stale-rounds.mjs'), validator);
});
