#!/usr/bin/env node
// Mint one curator API key. The bearer token is written to a new private file
// only. Stdout is the GRANTS_WATCH_CURATOR_KEYS entry (hash, id, name, scopes,
// expiry, revoked) and never the token.
import { randomBytes, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const SCOPES = new Set(['read_queue', 'decide', 'propose']);
const [id, name, scopeArg, expires, path] = process.argv.slice(2);
const scopes = (scopeArg || '').split(',').map((scope) => scope.trim()).filter(Boolean);

function usage() {
  console.error('Usage: node scripts/create-curator-key.mjs ID NAME SCOPES FUTURE_UTC_EXPIRY NEW_PRIVATE_FILE');
  console.error('SCOPES is a comma-separated list: read_queue, decide, propose');
  process.exit(1);
}

if (!/^[a-z0-9-]{1,40}$/.test(id || '') || !name || name.length > 80 || name.trim() !== name || /[\u0000-\u001f\u007f]/.test(name)) usage();
if (!scopes.length || scopes.some((scope) => !SCOPES.has(scope)) || new Set(scopes).size !== scopes.length) usage();
if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(expires || '') || !Number.isFinite(Date.parse(expires)) || Date.parse(expires) <= Date.now() || !path) {
  usage();
}

const token = randomBytes(32).toString('base64url');
try {
  await writeFile(path, `${token}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({
    id,
    name,
    sha256: createHash('sha256').update(token).digest('hex'),
    scopes,
    expires_at: expires,
    revoked: false,
  }));
} catch {
  console.error('Could not create a new private token file; no existing file was overwritten.');
  process.exitCode = 1;
}
