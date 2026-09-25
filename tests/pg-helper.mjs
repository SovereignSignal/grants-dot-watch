// Shared plumbing for the Postgres-backed characterization tests. Owns the
// one direct connection they assert through, the truncate between tests, and
// the skip that keeps `npm test` database-free by default: with no
// TEST_DATABASE_URL the suite skips and never touches pg at all.
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
/** node:test's `skip` option — a reason string skips, `false` runs. */
export const skipWithoutPg = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

const DESK_TABLES = ['desk_applied_changes', 'desk_verdicts', 'desk_proposals', 'ingest_state'];

/** One throwaway database, more than one Postgres suite, and `node --test`
 *  runs test FILES concurrently — so without this the suites TRUNCATE each
 *  other's fixtures mid-test and both go red for reasons that have nothing to
 *  do with the code. A session-scoped advisory lock taken on connect gives
 *  each file the cluster for its whole run, and the session ending (closePg,
 *  or the process exiting) releases it, so nothing can be left behind.
 *  Blocking, never try: the waiting file must still run, just later. The key
 *  is the suite's own — 8892011 (ingest) and 8892012 (the ledger guard)
 *  belong to the code under test, which asserts on them. */
const SUITE_LOCK_KEY = 8892090;

let clientPromise = null;

/** A single long-lived session, deliberately NOT desk-store's pool: the
 *  advisory-lock tests need a holder outside the code under test, and a
 *  Client we own is a Client we can end() so the suite exits. */
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

/** Take the suite lock before any database work that does not go through
 *  sql() — desk-store's own pool, a boot replay's pool. Call it first in a
 *  before() hook; everything routed through sql() takes it on its own. */
export async function lockDatabase() {
  await connection();
}

export async function sql(text, params = []) {
  return (await connection()).query(text, params);
}

export async function rows(text, params = []) {
  return (await sql(text, params)).rows;
}

export async function row(text, params = []) {
  return (await rows(text, params))[0] ?? null;
}

export async function closePg() {
  if (!clientPromise) return;
  const open = clientPromise;
  clientPromise = null;
  await (await open).end(); // ending the session is what releases the suite lock
}

/** RESTART IDENTITY so desk_applied_changes ids are predictable per test.
 *  Requires the tables to exist — warm desk-store once first, since
 *  ensureSchema is what self-provisions them. */
export async function truncateDeskTables() {
  await sql(`TRUNCATE ${DESK_TABLES.join(', ')} RESTART IDENTITY`);
}

/** desk-store captures REPO_ROOT = process.cwd() at module scope, and
 *  maybeImportLocalStore will silently import a .data/desk.json it finds
 *  there. Run from a throwaway directory so neither .data/ nor seed/ leaks
 *  into a test. */
export function sandboxCwd() {
  const dir = mkdtempSync(join(tmpdir(), 'grants-watch-pg-'));
  process.chdir(dir);
  return dir;
}

/** DATABASE_URL is read once at module scope (desk-store.ts:25), so it has to
 *  be set before the first evaluation — hence the dynamic import. `fresh`
 *  gives a second module instance with its own Pool and its own unmemoized
 *  ensureSchema, which is how a second process's DDL run is simulated. */
export async function loadDeskStore({ fresh = false } = {}) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  return import(`../src/lib/desk-store.ts${fresh ? `?fresh=${Date.now()}` : ''}`);
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}
