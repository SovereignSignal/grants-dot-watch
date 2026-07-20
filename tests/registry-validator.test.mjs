import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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
