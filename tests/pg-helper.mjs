// Shared plumbing for destructive tests against an isolated loopback database.
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  const u = new URL(TEST_DATABASE_URL),host = u.hostname.replace(/^\[|\]$/g, '');
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(host) || !/(?:^|_)test(?:_|$)/.test(u.pathname.slice(1))) throw new Error('Destructive test helpers require a loopback test database');
}
export const skipWithoutPg = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';
const DESK_TABLES = ['desk_applied_changes', 'desk_verdicts', 'desk_proposals', 'ingest_state'];
const SUITE_LOCK_KEY = 8892090;
let clientPromise = null;
async function connect() {
  const fresh = new Client({ connectionString: TEST_DATABASE_URL });
  await fresh.connect();
  await fresh.query('SELECT pg_advisory_lock($1)', [SUITE_LOCK_KEY]);
  return fresh;
}
async function connection() {
  if (!clientPromise) clientPromise = connect();
  return clientPromise;
}
export async function lockDatabase() { await connection(); }
export async function sql(text, params = []) { return (await connection()).query(text, params); }
export async function rows(text, params = []) { return (await sql(text, params)).rows; }
export async function row(text, params = []) { return (await rows(text, params))[0] ?? null; }
export async function closePg() {
  if (!clientPromise) return;
  const open = clientPromise;clientPromise = null;
  await (await open).end();
}
export async function truncateDeskTables() { await sql(`TRUNCATE ${DESK_TABLES.join(', ')} RESTART IDENTITY`); }
export function sandboxCwd() {
  const dir = mkdtempSync(join(tmpdir(), 'grants-watch-pg-'));process.chdir(dir);return dir;
}
export async function loadDeskStore({ fresh = false } = {}) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  return import(`../src/lib/desk-store.ts${fresh ? `?fresh=${Date.now()}` : ''}`);
}
export function sha256(content) { return createHash('sha256').update(content).digest('hex'); }
