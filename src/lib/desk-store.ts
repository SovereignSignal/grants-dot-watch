import { migrateDeskSchema, verifyDeskSchema } from './desk-schema.mjs';
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
import { productDateISO } from './round-state';
import type { Proposal, ProposalType, Verdict, Wire } from './types';
import { laneFor } from '../proposal-lanes';

const REPO_ROOT = process.cwd();
const DATA_DIR = join(REPO_ROOT, '.data');
const STORE_PATH = join(DATA_DIR, 'desk.json');
const PENDING_COMMITS_PATH = join(DATA_DIR, 'pending-commits.jsonl');
const SEED_DIR = join(REPO_ROOT, 'seed');

const DATABASE_URL = process.env.DATABASE_URL;
const APPLY_LEASE_MS = 15 * 60 * 1000;

/** The live backend. Never throws — the page that reports a fail-closed
 *  misconfiguration must not be taken down by it. 'unconfigured' is
 *  production with no DATABASE_URL: approvals would land in .data/ on a
 *  container whose filesystem dies with it, and the site would revert while
 *  still stamping itself freshly updated off file mtime.
 *  GRANTS_WATCH_ALLOW_LOCAL_STORE=1 is the deliberate opt-out for a
 *  production-mode build with no database (the Playwright suite). NODE_ENV
 *  and the opt-out are read live rather than captured: this module has two
 *  instances (the instrumentation chunk and the page bundles) and they must
 *  not be able to disagree about the rule. */
export function storeBackend(): 'postgres' | 'local' | 'unconfigured' {
  if (DATABASE_URL) return 'postgres';
  if (process.env.NODE_ENV === 'production' && process.env.GRANTS_WATCH_ALLOW_LOCAL_STORE !== '1') return 'unconfigured';
  return 'local';
}

/** Which backend a call takes, plus the production fail-closed. Checked on
 *  first store access, never at module load: admin/health/page.tsx imports
 *  this module at module scope and `next build` evaluates page modules, so a
 *  load-time throw would break the build. */
function pgBacked(): boolean {
  const backend = storeBackend();
  if (backend === 'unconfigured') {
    throw new Error('DATABASE_URL is not set: the Desk store refuses an ephemeral local file in production');
  }
  return backend === 'postgres';
}

interface RecordVerdictOptions {
  note?: string;
  commit?: string | null;
  by?: 'machine' | 'owner';
  from?: 'pending' | 'applying';
  /** A no-git filesystem mutation may become replayable only in the same
   * Postgres transaction that records its approved verdict. */
  ledgerRequired?: boolean;
}

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
  return pgBacked() ? insertIngestProposalsPg(candidates) : insertIngestProposalsLocal(candidates);
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
 *  see the explicit Desk migration command); a flat .data/ingest-state.json file in local/JSON-desk
 *  mode, same {key: value} shape, so ingest.ts's watermark logic never has
 *  to know which backend it's on. */
export async function getIngestState(key: string): Promise<unknown | null> {
  if (!pgBacked()) {
    const state = readLocalIngestState();
    return key in state ? state[key] : null;
  }
  await ensureSchema();
  const db = getPool();
  const { rows } = await db.query('SELECT value FROM ingest_state WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setIngestState(key: string, value: unknown): Promise<void> {
  if (!pgBacked()) {
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
  if (!pgBacked()) {
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
  const today = productDateISO();
  let pendingJudgment = 0;
  let pendingFact = 0;
  let decidedToday = 0;
  for (const p of proposals) {
    if (p.state !== 'pending') continue;
    if (p.lane === 'judgment') pendingJudgment++;
    else pendingFact++;
  }
  for (const v of verdicts) {
    const decidedAt = new Date(v.at);
    if (!Number.isNaN(decidedAt.getTime()) && productDateISO(decidedAt) === today) decidedToday++;
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
  opts?: RecordVerdictOptions
): Promise<{ proposal: Proposal; verdict: Verdict }> {
  if (opts?.ledgerRequired) {
    throw new Error('GRANTS_WATCH_NO_GIT=1 requires DATABASE_URL for durable approvals');
  }
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

function recoveredValidation(at: string): Proposal['validation'] {
  return {
    checks: [{ name: 'apply-reconciliation-required', pass: false, detail: 'stale applying state is quarantined' }],
    reason: 'prior apply attempt did not finish; reconcile the durable ledger before changing this proposal',
    checked_at: at,
  };
}

async function recoverStaleProposalClaimsLocal(maxAgeMs: number): Promise<number> {
  const store = readLocalStore();
  const now = new Date();
  const cutoff = now.getTime() - maxAgeMs;
  let recovered = 0;
  store.proposals = store.proposals.map((proposal) => {
    if (proposal.state !== 'applying') return proposal;
    const appliedAt = proposal.applying_at ? Date.parse(proposal.applying_at) : Number.NaN;
    if (Number.isFinite(appliedAt) && appliedAt >= cutoff) return proposal;
    if (proposal.validation?.checks.some((check) => check.name === 'apply-reconciliation-required')) return proposal;
    recovered++;
    return { ...proposal, validation: recoveredValidation(now.toISOString()) };
  });
  if (recovered > 0) writeLocalStore(store);
  return recovered;
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
  if (process.env.NODE_ENV === 'production') {
    await verifyDeskSchema(db);
    return;
  }
  await migrateDeskSchema(db);
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
  opts?: RecordVerdictOptions
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

    if (decision === 'approved') {
      const ledger = await client.query(
        `UPDATE desk_applied_changes
            SET state = 'ready', last_error = NULL
          WHERE proposal_id = $1 AND state = 'prepared'
          RETURNING id`,
        [id]
      );
      if (opts?.ledgerRequired && (ledger.rowCount ?? 0) === 0) {
        throw new Error(`proposal ${id} has no prepared durable ledger entry`);
      }
    } else {
      await client.query(
        `UPDATE desk_applied_changes SET state = 'abandoned'
          WHERE proposal_id = $1 AND state = 'prepared'`,
        [id]
      );
    }

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
  const client = await db.connect();
  const applyingAt = new Date().toISOString();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE desk_proposals
         SET state = 'applying',
             data = data || $2::jsonb
       WHERE id = $1 AND state = 'pending'
       RETURNING data`,
      [id, JSON.stringify({ state: 'applying', applying_at: applyingAt })]
    );
    if (rows.length > 0) {
      // A proposal can only become pending again through an explicit release.
      // Any older unfinished intent must stay non-replayable before retry.
      await client.query(
        `UPDATE desk_applied_changes SET state = 'abandoned'
          WHERE proposal_id = $1 AND state = 'prepared'`,
        [id]
      );
    }
    await client.query('COMMIT');
    return (rows[0]?.data as Proposal | undefined) ?? null;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function releaseProposalClaimPg(id: string, validation?: Proposal['validation']): Promise<boolean> {
  await ensureSchema();
  const db = getPool();
  const client = await db.connect();
  const patch = { state: 'pending', ...(validation ? { validation } : {}) };
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE desk_proposals
         SET state = 'pending',
             data = (data - 'applying_at') || $2::jsonb
       WHERE id = $1 AND state = 'applying'`,
      [id, JSON.stringify(patch)]
    );
    await client.query(
      `UPDATE desk_applied_changes SET state = 'abandoned'
        WHERE proposal_id = $1 AND state = 'prepared'`,
      [id]
    );
    await client.query('COMMIT');
    return (rowCount ?? 0) > 0;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function recoverStaleProposalClaimsPg(maxAgeMs: number): Promise<number> {
  await ensureSchema();
  const db = getPool();
  const now = new Date();
  const cutoff = new Date(now.getTime() - maxAgeMs).toISOString();
  const patch = { validation: recoveredValidation(now.toISOString()) };
  const { rowCount } = await db.query(
    `UPDATE desk_proposals
       SET data = data || $2::jsonb
     WHERE state = 'applying'
       AND ((data->>'applying_at') IS NULL OR (data->>'applying_at') < $1)
       AND COALESCE(data->'validation'->'checks'->0->>'name', '') <> 'apply-reconciliation-required'`,
    [cutoff, JSON.stringify(patch)]
  );
  return rowCount ?? 0;
}

// ============================================================
// Exported interface — same shape regardless of backend
// ============================================================

/** Idempotently import proposals-batch-*.json and proposals-enrich-batch-*.json
 *  (miner + enrichment-sweep output) and resolution_report.json merge_candidates
 *  into the store. Safe to call repeatedly — already-imported items are skipped
 *  by dedupe key. */
export async function seedFromFiles(): Promise<{ imported: number; skipped: number }> {
  return pgBacked() ? seedFromFilesPg() : seedFromFilesLocal();
}

export async function listProposals(filter?: { lane?: 'judgment' | 'fact'; state?: Proposal['state'] }, opts: { recoverClaims?: boolean } = {}): Promise<Proposal[]> {
  // Operator queue reads retain recovery; evidence previews explicitly opt out.
  if (opts.recoverClaims !== false) await recoverStaleProposalClaims();
  return pgBacked() ? listProposalsPg(filter) : listProposalsLocal(filter);
}

export async function getProposal(id: string): Promise<Proposal | null> {
  await recoverStaleProposalClaims();
  return pgBacked() ? getProposalPg(id) : getProposalLocal(id);
}

/** Newest first. */
export async function listVerdicts(): Promise<Verdict[]> {
  return pgBacked() ? listVerdictsPg() : listVerdictsLocal();
}

export async function queueCounts(): Promise<{ pendingJudgment: number; pendingFact: number; decidedToday: number; total: number }> {
  return pgBacked() ? queueCountsPg() : queueCountsLocal();
}

/** Record a decision already carried out by the caller (committer.ts does the
 *  file mutation + git commit; this just moves the proposal + logs the verdict).
 *  `by` defaults to unset (interpreted as 'owner' everywhere it's read) —
 *  only validation-runner.ts passes 'machine'. */
export async function recordVerdict(
  id: string,
  decision: 'approved' | 'rejected',
  opts?: RecordVerdictOptions
): Promise<{ proposal: Proposal; verdict: Verdict }> {
  return pgBacked() ? recordVerdictPg(id, decision, opts) : recordVerdictLocal(id, decision, opts);
}

/** Persist a validator run's result onto a still-pending proposal (FAIL case
 *  only — a PASS goes through recordVerdict instead). Never throws on a
 *  missing proposal; a run racing a manual decision just no-ops. */
export async function setProposalValidation(id: string, validation: Proposal['validation']): Promise<void> {
  return pgBacked() ? setProposalValidationPg(id, validation) : setProposalValidationLocal(id, validation);
}

/** Atomically owns a pending proposal before any registry write. */
export async function claimProposal(id: string): Promise<Proposal | null> {
  return pgBacked() ? claimProposalPg(id) : claimProposalLocal(id);
}

/** Returns an owned proposal to the queue when no registry write landed. */
export async function releaseProposalClaim(id: string, validation?: Proposal['validation']): Promise<boolean> {
  return pgBacked() ? releaseProposalClaimPg(id, validation) : releaseProposalClaimLocal(id, validation);
}

/** Applying is a lease, not a terminal state. Interrupted workers remain
 *  quarantined and surface in the Desk's reconciliation hold. */
export async function recoverStaleProposalClaims(maxAgeMs: number = APPLY_LEASE_MS): Promise<number> {
  return pgBacked() ? recoverStaleProposalClaimsPg(maxAgeMs) : recoverStaleProposalClaimsLocal(maxAgeMs);
}

// ---- durable applied-changes ledger ----

export interface AppliedChangeEntry {
  proposal_id: string | null; // one id, or comma-joined ids for a bulk approve
  files: {
    path: string;
    /** sha256 of the canonical file before this change; null means it did not
     *  exist. Omitted only for legacy rows, which replay must treat as a
     *  manual conflict rather than overwrite blindly. */
    content_before_hash?: string | null;
    content_after: string;
  }[];
  message: string;
}

export type AppliedChangeState = 'prepared' | 'ready' | 'abandoned';

/** Why an incoming change may not chain onto the newest unsynced row already
 *  holding its path, or null when it legitimately may. Only a 'ready' row is
 *  chainable: a 'prepared' row is uncommitted intent that a reject, a re-claim
 *  or a release can still abandon (recordVerdictPg, claimProposalPg,
 *  releaseProposalClaimPg), so chaining onto one bases this change on a state
 *  no replay ever produces. The three content_before_hash shapes are distinct
 *  and none but a hex string can follow an existing row. */
function chainRefusal(
  prior: { state: string; after: unknown },
  file: AppliedChangeEntry['files'][number]
): string | null {
  if (prior.state !== 'ready') return 'that row is still prepared and can still be abandoned';
  const after = prior.after;
  if (typeof after !== 'string') return 'that row carries no replayable content';
  if (!Object.prototype.hasOwnProperty.call(file, 'content_before_hash')) {
    return 'this change carries no base hash to chain onto it';
  }
  if (file.content_before_hash === null) return 'this change claims the path does not exist yet';
  if (typeof file.content_before_hash !== 'string') return 'this change has an unusable base hash';
  if (createHash('sha256').update(after).digest('hex') !== file.content_before_hash) {
    return 'this change was prepared against different bytes';
  }
  return null;
}

export interface AppliedChangeReceipt {
  backend: 'postgres' | 'local';
  id: number | null;
  state: AppliedChangeState;
}

export interface AppliedChangeLedgerHealth {
  ready: number;
  prepared: number;
  conflicts: number;
  oldestReadyAt: string | null;
}

function appendPendingCommitLocal(entry: AppliedChangeEntry): AppliedChangeReceipt {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(PENDING_COMMITS_PATH, `${JSON.stringify({ ...entry, state: 'ready', at: new Date().toISOString() })}\n`, 'utf8');
  return { backend: 'local', id: null, state: 'ready' };
}

/** Durably persist an applied-but-uncommitted change set (committer.ts calls
 *  this whenever a commit produced no sha: the GRANTS_WATCH_NO_GIT guard, or
 *  a git failure). Postgres (desk_applied_changes) when DATABASE_URL is set —
 *  the Railway case, where the filesystem is ephemeral — with the local
 *  .data/pending-commits.jsonl as the persistent-checkout fallback for a git
 *  failure. Production no-git writes require Postgres and fail closed. */
export async function recordAppliedChanges(
  entry: AppliedChangeEntry,
  state: AppliedChangeState = 'ready'
): Promise<AppliedChangeReceipt> {
  if (!pgBacked()) {
    if (process.env.GRANTS_WATCH_NO_GIT === '1') {
      throw new Error('GRANTS_WATCH_NO_GIT=1 requires DATABASE_URL for durable approvals');
    }
    // A persistent local checkout has no transactional database. A prepared
    // git-failure handoff is immediately replayable from its append-only file.
    return appendPendingCommitLocal(entry);
  }

  if (state === 'prepared') {
    await ensureSchema();
    const db = getPool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [8892012]);
      const paths = entry.files.map((file) => file.path);
      const conflict = await client.query(
        `SELECT id, proposal_id, state, files
           FROM desk_applied_changes AS pending
          WHERE synced_at IS NULL
            AND state IN ('prepared', 'ready')
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(pending.files) AS file
               WHERE file->>'path' = ANY($1::text[])
            )
          ORDER BY id ASC`,
        [paths]
      );
      // A second unsynced row on a path is legitimate when it was prepared
      // against the newest one's result: boot replay and the sync script both
      // apply rows in id order, so the chain reproduces. Refuse only a genuine
      // fork. Without this, the first approval to a file blocks every later
      // approval to that file until a human runs scripts/sync-desk-commits.mjs
      // — and boot replay never sets synced_at, so in production that wait is
      // unbounded. Rows arrive id-ascending, so the last write per path wins.
      const head = new Map<string, { id: number; proposal_id: string | null; state: string; after: unknown }>();
      for (const row of conflict.rows) {
        const rowFiles = Array.isArray(row.files) ? (row.files as AppliedChangeEntry['files']) : [];
        for (const file of rowFiles) {
          if (!file || !paths.includes(file.path)) continue;
          head.set(file.path, { id: row.id, proposal_id: row.proposal_id, state: row.state, after: file.content_after });
        }
      }
      for (const file of entry.files) {
        const prior = head.get(file.path);
        if (!prior) continue;
        const reason = chainRefusal(prior, file);
        if (reason) {
          throw new Error(
            `registry path has unsynced Desk ledger row ${prior.id}${prior.proposal_id ? ` (${prior.proposal_id})` : ''}: ${reason}`
          );
        }
      }
      const inserted = await client.query(
        `INSERT INTO desk_applied_changes (proposal_id, files, message, state)
         VALUES ($1, $2, $3, 'prepared') RETURNING id`,
        [entry.proposal_id, JSON.stringify(entry.files), entry.message]
      );
      await client.query('COMMIT');
      return { backend: 'postgres', id: Number(inserted.rows[0].id), state };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  try {
    await ensureSchema();
    const db = getPool();
    const inserted = await db.query(
      `INSERT INTO desk_applied_changes (proposal_id, files, message, state) VALUES ($1, $2, $3, $4) RETURNING id`,
      [entry.proposal_id, JSON.stringify(entry.files), entry.message, state]
    );
    return { backend: 'postgres', id: Number(inserted.rows[0].id), state };
  } catch (e) {
    if (process.env.GRANTS_WATCH_NO_GIT === '1') {
      throw new Error(`durable Desk ledger unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    return appendPendingCommitLocal(entry);
  }
}

export async function getAppliedChangeLedgerHealth(): Promise<AppliedChangeLedgerHealth> {
  if (!pgBacked()) {
    if (!existsSync(PENDING_COMMITS_PATH)) return { ready: 0, prepared: 0, conflicts: 0, oldestReadyAt: null };
    const rows = readFileSync(PENDING_COMMITS_PATH, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as { state?: string; at?: string }];
        } catch {
          return [];
        }
      })
      .filter((row) => !row.state || row.state === 'ready');
    const oldestReadyAt = rows.map((row) => row.at).filter((at): at is string => !!at).sort()[0] ?? null;
    return { ready: rows.length, prepared: 0, conflicts: 0, oldestReadyAt };
  }
  await ensureSchema();
  const db = getPool();
  const { rows } = await db.query(`
    SELECT
      count(*) FILTER (WHERE synced_at IS NULL AND state = 'ready')::int AS ready,
      count(*) FILTER (WHERE synced_at IS NULL AND state = 'prepared')::int AS prepared,
      count(*) FILTER (WHERE synced_at IS NULL AND state = 'ready' AND last_error IS NOT NULL)::int AS conflicts,
      min(created_at) FILTER (WHERE synced_at IS NULL AND state = 'ready') AS oldest_ready_at
    FROM desk_applied_changes
  `);
  return {
    ready: rows[0]?.ready ?? 0,
    prepared: rows[0]?.prepared ?? 0,
    conflicts: rows[0]?.conflicts ?? 0,
    oldestReadyAt: rows[0]?.oldest_ready_at ? new Date(rows[0].oldest_ready_at).toISOString() : null,
  };
}
