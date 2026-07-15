// Server-only store for The Desk (the curation queue). Files are the truth
// for the registry; this store is disposable operational state — the
// pending/decided proposal log — mirroring the "Postgres holds only
// operational state" split in docs/DESIGN.md.
//
// Two backends behind the same exported async interface:
//   - DATABASE_URL set   -> Postgres (desk_proposals / desk_verdicts / ingest_state)
//   - DATABASE_URL unset -> the original JSON-file backend (local dev)
// On first Postgres use, if desk_proposals is empty and the local .data/desk.json
// file exists, its proposals + verdicts are imported once.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import type { Proposal, ProposalType, Verdict, Wire } from './types';
import { laneFor } from '../proposal-lanes';

const REPO_ROOT = process.cwd();
const DATA_DIR = join(REPO_ROOT, '.data');
const STORE_PATH = join(DATA_DIR, 'desk.json');
const PENDING_COMMITS_PATH = join(DATA_DIR, 'pending-commits.jsonl');
const SEED_DIR = join(REPO_ROOT, 'seed');

const DATABASE_URL = process.env.DATABASE_URL;

interface Store {
  proposals: Proposal[];
  verdicts: Verdict[];
}

// ---- shared helpers (used by both backends) ----

function makeIdCounterFrom(ids: string[]): () => string {
  let max = 0;
  for (const id of ids) {
    const m = /^p(\d+)$/.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return () => `p${String(++max).padStart(5, '0')}`;
}

/** signal_id+type+org when we have a signal_id; a content hash otherwise. */
function dedupeKeyOf(input: {
  type: string;
  org?: string | null;
  org_name?: string | null;
  signal_id?: string | number;
  title: string;
  evidence_url?: string | null;
}): string {
  if (input.signal_id != null) {
    return `sig:${input.type}:${input.org ?? input.org_name ?? ''}:${input.signal_id}`;
  }
  const h = createHash('sha1').update(`${input.type}|${input.title}|${input.evidence_url || ''}`).digest('hex');
  return `hash:${h}`;
}

export interface RawMinerProposal {
  type: ProposalType;
  org?: string | null;
  org_name?: string | null;
  program?: string | null;
  title: string;
  summary: string;
  evidence_url?: string | null;
  proposed_change?: Record<string, unknown>;
  confidence?: number;
  signal_id?: number | string;
  wire?: Wire | null;
}

interface ResolutionReport {
  merge_candidates?: { a: string; b: string; domain: string }[];
}

/** Reads seed/proposals-batch-*.json and seed/proposals-enrich-batch-*.json
 *  (miner + enrichment-sweep output) and resolution_report.json
 *  merge_candidates, skipping anything already covered by existingKeys
 *  (mutated in place as new keys are claimed, so within-call dupes also
 *  skip). Storage-agnostic: returns proposals to insert, doesn't write
 *  anywhere. Safe to call repeatedly given a fresh existingKeys snapshot. */
function collectSeedProposals(
  existingKeys: Set<string>,
  nextId: () => string
): { proposals: Proposal[]; skipped: number } {
  const proposals: Proposal[] = [];
  let skipped = 0;

  const batchFiles = existsSync(SEED_DIR)
    ? readdirSync(SEED_DIR)
        .filter((f) => /^proposals-.*batch-\d+\.json$/.test(f))
        .sort()
    : [];

  for (const f of batchFiles) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(SEED_DIR, f), 'utf8'));
    } catch {
      continue; // a broken batch file never takes seeding down
    }
    if (!Array.isArray(raw)) continue;
    for (const item of raw as RawMinerProposal[]) {
      if (!item || !item.type || !item.title || !item.summary) {
        skipped++;
        continue;
      }
      const key = dedupeKeyOf(item);
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }
      const proposal: Proposal = {
        id: nextId(),
        type: item.type,
        org: item.org ?? null,
        org_name: item.org_name ?? null,
        program: item.program ?? null,
        title: item.title,
        summary: item.summary,
        evidence_url: item.evidence_url ?? null,
        proposed_change: item.proposed_change,
        confidence: item.confidence,
        signal_id: item.signal_id,
        wire: item.wire ?? null,
        lane: laneFor(item.type, item.evidence_url),
        state: 'pending',
        created_at: new Date().toISOString(),
      };
      proposals.push(proposal);
      existingKeys.add(key);
    }
  }

  const reportPath = join(SEED_DIR, 'resolution_report.json');
  if (existsSync(reportPath)) {
    try {
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as ResolutionReport;
      for (const mc of report.merge_candidates || []) {
        if (!mc || !mc.a || !mc.b) {
          skipped++;
          continue;
        }
        const title = `Are ${mc.a} and ${mc.b} the same org? Same domain ${mc.domain}.`;
        const evidenceUrl = mc.domain ? `https://${mc.domain}` : null;
        const key = dedupeKeyOf({ type: 'merge_orgs', org: mc.a, title, evidence_url: evidenceUrl });
        if (existingKeys.has(key)) {
          skipped++;
          continue;
        }
        const proposal: Proposal = {
          id: nextId(),
          type: 'merge_orgs',
          org: mc.a,
          org_name: null,
          program: null,
          title,
          summary: `Both "${mc.a}" and "${mc.b}" resolve to domain ${mc.domain}. Confirm they are the same organization, or reject to keep them distinct.`,
          evidence_url: evidenceUrl,
          proposed_change: { a: mc.a, b: mc.b, domain: mc.domain },
          wire: null,
          lane: 'judgment',
          state: 'pending',
          created_at: new Date().toISOString(),
        };
        proposals.push(proposal);
        existingKeys.add(key);
      }
    } catch {
      // malformed resolution report never takes seeding down
    }
  }

  return { proposals, skipped };
}

// ---- ingest.ts dedupe (daily ingest loop, wire + discuss.watch) ----
//
// Mirrors proposal-validator.ts's norm() exactly (lowercase, strip
// diacritics, collapse to single spaces) but duplicated locally rather than
// imported: proposal-validator.ts imports committer.ts which imports THIS
// file, so an import the other way would be circular. It's five lines; a
// drift risk here is cheap to notice (dedupe just gets slightly looser), so
// duplication beats restructuring the module graph for it.
function normKey(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** One-shot creation/judgment types: a second proposal for the same
 *  org/program is always redundant (only one can ever be approved), so
 *  these get a secondary type+org/program dedupe key on top of the signal-ref
 *  key. Fact types (round_update/deadline_change/...) are deliberately
 *  EXCLUDED — a second deadline_change for the same program is often a
 *  legitimate new dated fact, not a duplicate, so they rely on signal-ref
 *  dedupe alone (each source item has its own signal_id). */
const ONE_SHOT_DEDUPE_TYPES: ReadonlySet<ProposalType> = new Set(['new_org', 'new_program', 'merge_orgs']);

function typeOrgProgramKeyOf(input: { type: ProposalType; org?: string | null; org_name?: string | null; program?: string | null }): string {
  return `tp:${input.type}:${normKey(input.org || input.org_name)}:${normKey(input.program)}`;
}

interface IngestDedupeState {
  sigKeys: Set<string>;
  tpKeys: Set<string>;
}

function buildIngestDedupeState(existing: Proposal[]): IngestDedupeState {
  const sigKeys = new Set(existing.map((p) => dedupeKeyOf(p)));
  const tpKeys = new Set(existing.filter((p) => ONE_SHOT_DEDUPE_TYPES.has(p.type)).map((p) => typeOrgProgramKeyOf(p)));
  return { sigKeys, tpKeys };
}

/** Filters ingest.ts's mapped candidates down to genuinely-new proposals,
 *  checking (and updating, so within-batch dupes across the two sources also
 *  collapse) both dedupe key sets. Storage-agnostic — callers do the actual
 *  insert. */
function filterNewIngestCandidates(
  candidates: RawMinerProposal[],
  state: IngestDedupeState
): { accepted: RawMinerProposal[]; skipped: number } {
  const accepted: RawMinerProposal[] = [];
  let skipped = 0;
  for (const c of candidates) {
    if (!c || !c.type || !c.title || !c.summary) {
      skipped++;
      continue;
    }
    const sigKey = dedupeKeyOf(c);
    if (state.sigKeys.has(sigKey)) {
      skipped++;
      continue;
    }
    const tpKey = ONE_SHOT_DEDUPE_TYPES.has(c.type) ? typeOrgProgramKeyOf(c) : null;
    if (tpKey && state.tpKeys.has(tpKey)) {
      skipped++;
      continue;
    }
    accepted.push(c);
    state.sigKeys.add(sigKey);
    if (tpKey) state.tpKeys.add(tpKey);
  }
  return { accepted, skipped };
}

function proposalFromRaw(item: RawMinerProposal, nextId: () => string): Proposal {
  return {
    id: nextId(),
    type: item.type,
    org: item.org ?? null,
    org_name: item.org_name ?? null,
    program: item.program ?? null,
    title: item.title,
    summary: item.summary,
    evidence_url: item.evidence_url ?? null,
    proposed_change: item.proposed_change,
    confidence: item.confidence,
    signal_id: item.signal_id,
    wire: item.wire ?? null,
    lane: laneFor(item.type, item.evidence_url),
    state: 'pending',
    created_at: new Date().toISOString(),
  };
}

async function insertIngestProposalsLocal(candidates: RawMinerProposal[]): Promise<{ inserted: Proposal[]; skipped: number }> {
  const store = readLocalStore();
  const state = buildIngestDedupeState(store.proposals);
  const nextId = makeIdCounterFrom(store.proposals.map((p) => p.id));
  const { accepted, skipped } = filterNewIngestCandidates(candidates, state);
  const inserted = accepted.map((item) => proposalFromRaw(item, nextId));
  store.proposals.push(...inserted);
  if (inserted.length > 0) writeLocalStore(store);
  return { inserted, skipped };
}

async function insertIngestProposalsPg(candidates: RawMinerProposal[]): Promise<{ inserted: Proposal[]; skipped: number }> {
  await ensureSchema();
  const db = getPool();
  const { rows } = await db.query('SELECT id, data FROM desk_proposals');
  const existing = rows.map((r) => r.data as Proposal);
  const state = buildIngestDedupeState(existing);
  const nextId = makeIdCounterFrom(rows.map((r) => r.id as string));
  const { accepted, skipped } = filterNewIngestCandidates(candidates, state);

  const inserted: Proposal[] = [];
  if (accepted.length > 0) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const item of accepted) {
        const proposal = proposalFromRaw(item, nextId);
        await client.query(
          `INSERT INTO desk_proposals (id, data, lane, state, created_at) VALUES ($1, $2, $3, $4, $5)`,
          [proposal.id, proposal, proposal.lane, proposal.state, proposal.created_at]
        );
        inserted.push(proposal);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  return { inserted, skipped };
}

/** ingest.ts's insert door: takes already-mapped candidates (deterministic
 *  output of the wire/discuss.watch resolver — no seed/ files involved) and
 *  inserts whatever survives dedupe against every proposal on file
 *  (pending+decided), both by signal ref and — for new_org/new_program/
 *  merge_orgs — by (type, org, program). Safe to call repeatedly: a re-run
 *  over already-seen signals inserts nothing. */
export async function insertIngestProposals(candidates: RawMinerProposal[]): Promise<{ inserted: Proposal[]; skipped: number }> {
  return DATABASE_URL ? insertIngestProposalsPg(candidates) : insertIngestProposalsLocal(candidates);
}

// ---- ingest_state (watermarks + last-run log) ----

const INGEST_STATE_PATH = join(DATA_DIR, 'ingest-state.json');

function readLocalIngestState(): Record<string, unknown> {
  if (!existsSync(INGEST_STATE_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(INGEST_STATE_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalIngestState(state: Record<string, unknown>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = join(DATA_DIR, `.ingest-state.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, INGEST_STATE_PATH);
}

/** Reads one ingest_state row. Postgres in prod (the table already exists —
 *  see initSchema); a flat .data/ingest-state.json file in local/JSON-desk
 *  mode, same {key: value} shape, so ingest.ts's watermark logic never has
 *  to know which backend it's on. */
export async function getIngestState(key: string): Promise<unknown | null> {
  if (!DATABASE_URL) {
    const state = readLocalIngestState();
    return key in state ? state[key] : null;
  }
  await ensureSchema();
  const db = getPool();
  const { rows } = await db.query('SELECT value FROM ingest_state WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setIngestState(key: string, value: unknown): Promise<void> {
  if (!DATABASE_URL) {
    const state = readLocalIngestState();
    state[key] = value;
    writeLocalIngestState(state);
    return;
  }
  await ensureSchema();
  const db = getPool();
  await db.query(
    `INSERT INTO ingest_state (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

// ---- advisory lock (instrumentation.ts's daily timer) ----

// Arbitrary fixed key, unique to this app's ingest job — pg_try_advisory_lock
// takes any bigint; there's nothing else in this database that would collide.
const INGEST_LOCK_KEY = 8892011;

let localIngestMutex = false;

/** Runs `fn` only if no other instance/timer currently holds the ingest lock;
 *  otherwise returns { ran: false } without calling `fn`. Postgres session
 *  advisory lock when DATABASE_URL is set (works across Railway instances —
 *  the whole point, since a daily in-process timer runs on every replica);
 *  an in-process boolean in local/JSON-desk mode, where there's no shared
 *  Postgres to lock against and only ever one process anyway. */
export async function withIngestLock<T>(fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }> {
  if (!DATABASE_URL) {
    if (localIngestMutex) return { ran: false };
    localIngestMutex = true;
    try {
      return { ran: true, result: await fn() };
    } finally {
      localIngestMutex = false;
    }
  }
  const db = getPool();
  const client = await db.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [INGEST_LOCK_KEY]);
    if (!rows[0]?.locked) return { ran: false };
    try {
      return { ran: true, result: await fn() };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [INGEST_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

function computeQueueCounts(
  proposals: Proposal[],
  verdicts: Verdict[]
): { pendingJudgment: number; pendingFact: number; decidedToday: number; total: number } {
  const today = new Date().toISOString().slice(0, 10);
  let pendingJudgment = 0;
  let pendingFact = 0;
  let decidedToday = 0;
  for (const p of proposals) {
    if (p.state !== 'pending') continue;
    if (p.lane === 'judgment') pendingJudgment++;
    else pendingFact++;
  }
  for (const v of verdicts) {
    if (v.at.slice(0, 10) === today) decidedToday++;
  }
  return { pendingJudgment, pendingFact, decidedToday, total: proposals.length };
}

// ============================================================
// Local JSON-file backend (dev fallback, DATABASE_URL unset)
// ============================================================

function emptyStore(): Store {
  return { proposals: [], verdicts: [] };
}

function readLocalStore(): Store {
  if (!existsSync(STORE_PATH)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    return {
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      verdicts: Array.isArray(parsed.verdicts) ? parsed.verdicts : [],
    };
  } catch {
    // a corrupt store never takes the site down; treat as empty
    return emptyStore();
  }
}

function writeLocalStore(store: Store): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = join(DATA_DIR, `.desk.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  renameSync(tmp, STORE_PATH); // atomic on the same filesystem
}

async function seedFromFilesLocal(): Promise<{ imported: number; skipped: number }> {
  const store = readLocalStore();
  const existingKeys = new Set(store.proposals.map((p) => dedupeKeyOf(p)));
  const nextId = makeIdCounterFrom(store.proposals.map((p) => p.id));
  const { proposals, skipped } = collectSeedProposals(existingKeys, nextId);
  store.proposals.push(...proposals);
  writeLocalStore(store);
  return { imported: proposals.length, skipped };
}

async function listProposalsLocal(filter?: { lane?: 'judgment' | 'fact'; state?: Proposal['state'] }): Promise<Proposal[]> {
  const store = readLocalStore();
  return store.proposals.filter(
    (p) => (!filter?.lane || p.lane === filter.lane) && (!filter?.state || p.state === filter.state)
  );
}

async function getProposalLocal(id: string): Promise<Proposal | null> {
  return readLocalStore().proposals.find((p) => p.id === id) || null;
}

async function listVerdictsLocal(): Promise<Verdict[]> {
  return readLocalStore().verdicts;
}

async function queueCountsLocal(): Promise<{ pendingJudgment: number; pendingFact: number; decidedToday: number; total: number }> {
  const store = readLocalStore();
  return computeQueueCounts(store.proposals, store.verdicts);
}

async function recordVerdictLocal(
  id: string,
  decision: 'approved' | 'rejected',
  opts?: { note?: string; commit?: string | null; by?: 'machine' | 'owner'; from?: 'pending' | 'applying' }
): Promise<{ proposal: Proposal; verdict: Verdict }> {
  const store = readLocalStore();
  const idx = store.proposals.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`proposal not found: ${id}`);
  const expectedState = opts?.from ?? 'pending';
  if (store.proposals[idx].state !== expectedState) throw new Error(`proposal ${id} is no longer ${expectedState}`);

  const at = new Date().toISOString();
  const { applying_at: _applyingAt, ...current } = store.proposals[idx];
  const proposal: Proposal = { ...current, state: decision, decided_at: at, decision_note: opts?.note };
  store.proposals[idx] = proposal;
  const verdict: Verdict = {
    proposal_id: id,
    decision,
    note: opts?.note,
    at,
    commit: opts?.commit ?? null,
    ...(opts?.by ? { by: opts.by } : {}),
  };
  store.verdicts.unshift(verdict);
  writeLocalStore(store);
  return { proposal, verdict };
}

/** Updates a proposal's `validation` field in place — used by
 *  validation-runner.ts to persist a FAIL's checks/reason without touching
 *  state (the proposal stays pending; The Desk's exception queue reads this
 *  straight off the record). A no-op if the proposal has since vanished. */
async function setProposalValidationLocal(id: string, validation: Proposal['validation']): Promise<void> {
  const store = readLocalStore();
  const idx = store.proposals.findIndex((p) => p.id === id);
  if (idx === -1 || store.proposals[idx].state !== 'pending') return;
  store.proposals[idx] = { ...store.proposals[idx], validation };
  writeLocalStore(store);
}

async function claimProposalLocal(id: string): Promise<Proposal | null> {
  const store = readLocalStore();
  const idx = store.proposals.findIndex((p) => p.id === id);
  if (idx === -1 || store.proposals[idx].state !== 'pending') return null;
  const proposal: Proposal = { ...store.proposals[idx], state: 'applying', applying_at: new Date().toISOString() };
  store.proposals[idx] = proposal;
  writeLocalStore(store);
  return proposal;
}

async function releaseProposalClaimLocal(id: string, validation?: Proposal['validation']): Promise<boolean> {
  const store = readLocalStore();
  const idx = store.proposals.findIndex((p) => p.id === id);
  if (idx === -1 || store.proposals[idx].state !== 'applying') return false;
  const { applying_at: _applyingAt, ...current } = store.proposals[idx];
  store.proposals[idx] = { ...current, state: 'pending', ...(validation ? { validation } : {}) };
  writeLocalStore(store);
  return true;
}

// ============================================================
// Postgres backend (DATABASE_URL set)
// ============================================================

let pgPool: Pool | null = null;
function getPool(): Pool {
  if (!pgPool) pgPool = new Pool({ connectionString: DATABASE_URL });
  return pgPool;
}

let schemaReady: Promise<void> | null = null;
/** Lazy, memoized: creates the operational tables if missing, then (once,
 *  only if desk_proposals is still empty) imports the local .data/desk.json
 *  file as a one-time migration. Every Postgres-backed call awaits this
 *  first, so it's safe to call from any entry point in any order. */
function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = initSchema();
  return schemaReady;
}

async function initSchema(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS desk_proposals (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      lane text NOT NULL,
      state text NOT NULL,
      created_at timestamptz NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS desk_verdicts (
      proposal_id text NOT NULL,
      data jsonb NOT NULL,
      at timestamptz NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ingest_state (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Durable applied-changes ledger — same DDL as db/migrations/003_desk_ledger.sql
  // (kept in sync), created here too so the runtime never depends on the
  // loader having run against this database.
  await db.query(`
    CREATE TABLE IF NOT EXISTS desk_applied_changes (
      id serial PRIMARY KEY,
      proposal_id text,
      files jsonb NOT NULL,
      message text,
      sha text,
      synced_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_desk_applied_changes_unsynced
      ON desk_applied_changes (id) WHERE synced_at IS NULL
  `);
  await maybeImportLocalStore(db);
}

async function maybeImportLocalStore(db: Pool): Promise<void> {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM desk_proposals');
  if ((rows[0]?.n ?? 0) > 0) return;
  if (!existsSync(STORE_PATH)) return;
  const local = readLocalStore();
  if (local.proposals.length === 0 && local.verdicts.length === 0) return;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const p of local.proposals) {
      await client.query(
        `INSERT INTO desk_proposals (id, data, lane, state, created_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p, p.lane, p.state, p.created_at]
      );
    }
    for (const v of local.verdicts) {
      await client.query(`INSERT INTO desk_verdicts (proposal_id, data, at) VALUES ($1, $2, $3)`, [
        v.proposal_id,
        v,
        v.at,
      ]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function seedFromFilesPg(): Promise<{ imported: number; skipped: number }> {
  await ensureSchema();
  const db = getPool();
  const { rows } = await db.query('SELECT id, data FROM desk_proposals');
  const existingKeys = new Set(rows.map((r) => dedupeKeyOf(r.data as Proposal)));
  const nextId = makeIdCounterFrom(rows.map((r) => r.id as string));
  const { proposals, skipped } = collectSeedProposals(existingKeys, nextId);

  if (proposals.length > 0) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const p of proposals) {
        await client.query(
          `INSERT INTO desk_proposals (id, data, lane, state, created_at) VALUES ($1, $2, $3, $4, $5)`,
          [p.id, p, p.lane, p.state, p.created_at]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return { imported: proposals.length, skipped };
}

async function listProposalsPg(filter?: { lane?: 'judgment' | 'fact'; state?: Proposal['state'] }): Promise<Proposal[]> {
  await ensureSchema();
  const db = getPool();
  const conditions: string[] = [];
  const params: string[] = [];
  if (filter?.lane) {
    params.push(filter.lane);
    conditions.push(`lane = $${params.length}`);
  }
  if (filter?.state) {
    params.push(filter.state);
    conditions.push(`state = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(`SELECT data FROM desk_proposals ${where} ORDER BY created_at ASC`, params);
  return rows.map((r) => r.data as Proposal);
}

async function getProposalPg(id: string): Promise<Proposal | null> {
  await ensureSchema();
  const db = getPool();
  const { rows } = await db.query('SELECT data FROM desk_proposals WHERE id = $1', [id]);
  return rows[0]?.data ?? null;
}

async function listVerdictsPg(): Promise<Verdict[]> {
  await ensureSchema();
  const db = getPool();
  const { rows } = await db.query('SELECT data FROM desk_verdicts ORDER BY at DESC');
  return rows.map((r) => r.data as Verdict);
}

async function queueCountsPg(): Promise<{ pendingJudgment: number; pendingFact: number; decidedToday: number; total: number }> {
  const [proposals, verdicts] = await Promise.all([listProposalsPg(), listVerdictsPg()]);
  return computeQueueCounts(proposals, verdicts);
}

async function recordVerdictPg(
  id: string,
  decision: 'approved' | 'rejected',
  opts?: { note?: string; commit?: string | null; by?: 'machine' | 'owner'; from?: 'pending' | 'applying' }
): Promise<{ proposal: Proposal; verdict: Verdict }> {
  await ensureSchema();
  const db = getPool();
  const client: PoolClient = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT data, state FROM desk_proposals WHERE id = $1 FOR UPDATE', [id]);
    if (rows.length === 0) throw new Error(`proposal not found: ${id}`);
    const expectedState = opts?.from ?? 'pending';
    if (rows[0].state !== expectedState) throw new Error(`proposal ${id} is no longer ${expectedState}`);

    const at = new Date().toISOString();
    const { applying_at: _applyingAt, ...current } = rows[0].data as Proposal;
    const proposal: Proposal = { ...current, state: decision, decided_at: at, decision_note: opts?.note };
    await client.query('UPDATE desk_proposals SET data = $2, state = $3 WHERE id = $1', [id, proposal, decision]);
    const verdict: Verdict = {
      proposal_id: id,
      decision,
      note: opts?.note,
      at,
      commit: opts?.commit ?? null,
      ...(opts?.by ? { by: opts.by } : {}),
    };
    await client.query('INSERT INTO desk_verdicts (proposal_id, data, at) VALUES ($1, $2, $3)', [id, verdict, at]);
    await client.query('COMMIT');
    return { proposal, verdict };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Postgres counterpart of setProposalValidationLocal. */
async function setProposalValidationPg(id: string, validation: Proposal['validation']): Promise<void> {
  await ensureSchema();
  const db = getPool();
  await db.query(
    `UPDATE desk_proposals
       SET data = data || $2::jsonb
     WHERE id = $1 AND state = 'pending'`,
    [id, JSON.stringify({ validation })]
  );
}

async function claimProposalPg(id: string): Promise<Proposal | null> {
  await ensureSchema();
  const db = getPool();
  const applyingAt = new Date().toISOString();
  const { rows } = await db.query(
    `UPDATE desk_proposals
       SET state = 'applying',
           data = data || $2::jsonb
     WHERE id = $1 AND state = 'pending'
     RETURNING data`,
    [id, JSON.stringify({ state: 'applying', applying_at: applyingAt })]
  );
  return (rows[0]?.data as Proposal | undefined) ?? null;
}

async function releaseProposalClaimPg(id: string, validation?: Proposal['validation']): Promise<boolean> {
  await ensureSchema();
  const db = getPool();
  const patch = { state: 'pending', ...(validation ? { validation } : {}) };
  const { rowCount } = await db.query(
    `UPDATE desk_proposals
       SET state = 'pending',
           data = (data - 'applying_at') || $2::jsonb
     WHERE id = $1 AND state = 'applying'`,
    [id, JSON.stringify(patch)]
  );
  return (rowCount ?? 0) > 0;
}

// ============================================================
// Exported interface — same shape regardless of backend
// ============================================================

/** Idempotently import proposals-batch-*.json and proposals-enrich-batch-*.json
 *  (miner + enrichment-sweep output) and resolution_report.json merge_candidates
 *  into the store. Safe to call repeatedly — already-imported items are skipped
 *  by dedupe key. */
export async function seedFromFiles(): Promise<{ imported: number; skipped: number }> {
  return DATABASE_URL ? seedFromFilesPg() : seedFromFilesLocal();
}

export async function listProposals(filter?: { lane?: 'judgment' | 'fact'; state?: Proposal['state'] }): Promise<Proposal[]> {
  return DATABASE_URL ? listProposalsPg(filter) : listProposalsLocal(filter);
}

export async function getProposal(id: string): Promise<Proposal | null> {
  return DATABASE_URL ? getProposalPg(id) : getProposalLocal(id);
}

/** Newest first. */
export async function listVerdicts(): Promise<Verdict[]> {
  return DATABASE_URL ? listVerdictsPg() : listVerdictsLocal();
}

export async function queueCounts(): Promise<{ pendingJudgment: number; pendingFact: number; decidedToday: number; total: number }> {
  return DATABASE_URL ? queueCountsPg() : queueCountsLocal();
}

/** Record a decision already carried out by the caller (committer.ts does the
 *  file mutation + git commit; this just moves the proposal + logs the verdict).
 *  `by` defaults to unset (interpreted as 'owner' everywhere it's read) —
 *  only validation-runner.ts passes 'machine'. */
export async function recordVerdict(
  id: string,
  decision: 'approved' | 'rejected',
  opts?: { note?: string; commit?: string | null; by?: 'machine' | 'owner'; from?: 'pending' | 'applying' }
): Promise<{ proposal: Proposal; verdict: Verdict }> {
  return DATABASE_URL ? recordVerdictPg(id, decision, opts) : recordVerdictLocal(id, decision, opts);
}

/** Persist a validator run's result onto a still-pending proposal (FAIL case
 *  only — a PASS goes through recordVerdict instead). Never throws on a
 *  missing proposal; a run racing a manual decision just no-ops. */
export async function setProposalValidation(id: string, validation: Proposal['validation']): Promise<void> {
  return DATABASE_URL ? setProposalValidationPg(id, validation) : setProposalValidationLocal(id, validation);
}

/** Atomically owns a pending proposal before any registry write. */
export async function claimProposal(id: string): Promise<Proposal | null> {
  return DATABASE_URL ? claimProposalPg(id) : claimProposalLocal(id);
}

/** Returns an owned proposal to the queue when no registry write landed. */
export async function releaseProposalClaim(id: string, validation?: Proposal['validation']): Promise<boolean> {
  return DATABASE_URL ? releaseProposalClaimPg(id, validation) : releaseProposalClaimLocal(id, validation);
}

// ---- durable applied-changes ledger ----

export interface AppliedChangeEntry {
  proposal_id: string | null; // one id, or comma-joined ids for a bulk approve
  files: { path: string; content_after: string }[];
  message: string;
}

function appendPendingCommitLocal(entry: AppliedChangeEntry): void {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(PENDING_COMMITS_PATH, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, 'utf8');
}

/** Durably persist an applied-but-uncommitted change set (committer.ts calls
 *  this whenever a commit produced no sha: the GRANTS_WATCH_NO_GIT guard, or
 *  a git failure). Postgres (desk_applied_changes) when DATABASE_URL is set —
 *  the Railway case, where the filesystem is ephemeral — with the local
 *  .data/pending-commits.jsonl as the no-DB backend AND as the fallback if
 *  the insert itself fails; the ledger write must never take the approve
 *  down. scripts/sync-desk-commits.mjs replays unsynced rows into real
 *  commits. */
export async function recordAppliedChanges(entry: AppliedChangeEntry): Promise<void> {
  if (!DATABASE_URL) {
    appendPendingCommitLocal(entry);
    return;
  }
  try {
    await ensureSchema();
    const db = getPool();
    await db.query(`INSERT INTO desk_applied_changes (proposal_id, files, message) VALUES ($1, $2, $3)`, [
      entry.proposal_id,
      JSON.stringify(entry.files),
      entry.message,
    ]);
  } catch {
    appendPendingCommitLocal(entry);
  }
}
