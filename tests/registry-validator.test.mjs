import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

test('registry remains valid after the July 15 deadline rollovers', () => {
  const output = execFileSync(process.execPath, ['scripts/validate-registry.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, VALIDATION_TODAY: '2026-07-16' },
  });

  assert.match(output, /^OK: \d+ systems, \d+ orgs, \d+ programs validated$/m);
});

test('registry remains valid on the August 29 currency reset', () => {
  const output = execFileSync(process.execPath, ['scripts/validate-registry.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, VALIDATION_TODAY: '2026-08-29' },
  });

  assert.match(output, /^OK: \d+ systems, \d+ orgs, \d+ programs validated$/m);
});

test('undated live rounds cannot carry a past year in the name', () => {
  const root = mkdtempSync(join(tmpdir(), 'year-stale-'));
  for (const directory of ['systems', 'orgs', 'programs', 'awards']) mkdirSync(join(root, directory));
  writeFileSync(join(root, 'systems', 'test.yaml'), YAML.stringify({
    id: 'test',
    name: 'Test System',
    kind: 'funding-domain',
    wires: ['oss'],
    summary: 'A funding-domain system used only to exercise the year-stale standing rule.',
    sources: ['https://example.org/system'],
  }));
  writeFileSync(join(root, 'orgs', 'funder.yaml'), YAML.stringify({
    id: 'funder',
    name: 'Example Funder',
    roles: ['funder'],
    org_type: 'foundation',
    status: 'active',
    website: 'https://example.org/',
    profile: 'Example Funder publishes an open grant program used only for validator fixtures in this test.',
    sources: ['https://example.org/'],
  }));
  writeFileSync(join(root, 'programs', 'stale-standing.yaml'), YAML.stringify({
    id: 'stale-standing',
    name: 'Stale Standing',
    org: 'funder',
    systems: ['test'],
    wires: ['oss'],
    status: 'active',
    mechanism: 'grants',
    apply_url: 'https://example.org/apply',
    summary: 'A fixture program whose standing round is labeled with a year that has already ended.',
    rounds: [{ name: 'Rolling 2025 intake', status: 'open', source: 'https://example.org/apply' }],
    sources: ['https://example.org/apply'],
  }));

  assert.throws(
    () => execFileSync(process.execPath, ['scripts/validate-registry.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, REGISTRY_ROOT: root, VALIDATION_TODAY: '2026-08-29' },
    }),
    /past year/
  );
});

test('concluded programs cannot keep an apply_url', () => {
  const root = mkdtempSync(join(tmpdir(), 'concluded-apply-'));
  for (const directory of ['systems', 'orgs', 'programs', 'awards']) mkdirSync(join(root, directory));
  writeFileSync(join(root, 'systems', 'test.yaml'), YAML.stringify({
    id: 'test',
    name: 'Test System',
    kind: 'funding-domain',
    wires: ['oss'],
    summary: 'A funding-domain system used only to exercise the concluded apply_url rule.',
    sources: ['https://example.org/system'],
  }));
  writeFileSync(join(root, 'orgs', 'funder.yaml'), YAML.stringify({
    id: 'funder',
    name: 'Example Funder',
    roles: ['funder'],
    org_type: 'foundation',
    status: 'active',
    website: 'https://example.org/',
    profile: 'Example Funder publishes a closed grant program used only for validator fixtures in this test.',
    sources: ['https://example.org/'],
  }));
  writeFileSync(join(root, 'programs', 'closed-call.yaml'), YAML.stringify({
    id: 'closed-call',
    name: 'Closed Call',
    org: 'funder',
    systems: ['test'],
    wires: ['oss'],
    status: 'concluded',
    mechanism: 'grants',
    apply_url: 'https://example.org/apply',
    summary: 'A fixture program that is concluded but still advertises an application link.',
    rounds: [{ name: '2026 call', status: 'closed', closes: '2026-07-01', source: 'https://example.org/apply' }],
    sources: ['https://example.org/apply'],
  }));

  assert.throws(
    () => execFileSync(process.execPath, ['scripts/validate-registry.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, REGISTRY_ROOT: root, VALIDATION_TODAY: '2026-08-29' },
    }),
    /must not keep apply_url/
  );
});

test('fixed-deadline rounds are not labeled rolling', () => {
  const violations = [];

  for (const file of readdirSync('registry/programs').filter((name) => name.endsWith('.yaml'))) {
    const program = YAML.parse(readFileSync(`registry/programs/${file}`, 'utf8'));
    for (const round of program.rounds || []) {
      if (/^rolling$/i.test(round.name || '') && round.closes) violations.push(`${file}:${round.closes}`);
    }
  }

  assert.deepEqual(violations, []);
});
