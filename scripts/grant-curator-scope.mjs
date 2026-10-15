#!/usr/bin/env node
// Add one scope to an existing curator key. Reads the hash array from
// GRANTS_WATCH_CURATOR_KEYS or --keys-file. Prints the updated array.
// Does not read, rotate, or print a bearer token.
import { readFileSync } from 'node:fs';

const SCOPES = new Set(['read_queue', 'decide', 'propose', 'apply_low_risk']);
const args = process.argv.slice(2);
let file = null;
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--keys-file') {
    file = args[i + 1] || '';
    i += 1;
    continue;
  }
  positional.push(args[i]);
}
const [id, scope] = positional;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!/^[a-z0-9-]{1,40}$/.test(id || '') || !SCOPES.has(scope || '')) {
  fail('Usage: node scripts/grant-curator-scope.mjs KEY_ID SCOPE [--keys-file PATH]');
}

let raw;
if (file) {
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    fail('Could not read the keys file.');
  }
} else if (process.env.GRANTS_WATCH_CURATOR_KEYS) {
  raw = process.env.GRANTS_WATCH_CURATOR_KEYS;
} else {
  fail('GRANTS_WATCH_CURATOR_KEYS is not set. Pass --keys-file to read a hash array from disk.');
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  fail('Curator keys are not valid JSON.');
}
if (!Array.isArray(parsed)) fail('Curator keys must be a JSON array.');
const index = parsed.findIndex((entry) => entry && typeof entry === 'object' && entry.id === id);
if (index === -1) fail(`No curator key with id ${id}.`);
const entry = parsed[index];
if (!Array.isArray(entry.scopes) || entry.scopes.some((item) => typeof item !== 'string')) fail('That key has no scope list.');
if (entry.scopes.includes(scope)) {
  console.error(`${id} already has ${scope}.`);
} else {
  entry.scopes = [...entry.scopes, scope];
}
const secretKeys = ['token', 'secret', 'bearer', 'password'];
for (const key of parsed) {
  if (!key || typeof key !== 'object') continue;
  for (const secret of secretKeys) if (secret in key) fail('Refusing to print a key entry that carries a secret field.');
}
console.log(JSON.stringify(parsed));
