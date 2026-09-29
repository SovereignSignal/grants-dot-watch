#!/usr/bin/env node
// Run in a trusted operator environment. The bearer value is written to a
// new private file only; stdout contains the server-side hash configuration.
import { randomBytes, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const [id, expires, path] = process.argv.slice(2);
if (!/^[a-z0-9-]{1,40}$/.test(id || '') || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(expires || '')
  || !Number.isFinite(Date.parse(expires)) || Date.parse(expires) <= Date.now() || !path) {
  console.error('Usage: node scripts/create-reader-key.mjs CLIENT FUTURE_UTC_EXPIRY NEW_PRIVATE_FILE');
  process.exit(1);
}
const token = randomBytes(32).toString('base64url');
try {
  await writeFile(path, `${token}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify([{ id, sha256: createHash('sha256').update(token).digest('hex'), expires_at: expires }]));
} catch {
  console.error('Could not create a new private token file; no existing file was overwritten.');
  process.exitCode = 1;
}
