// Server-only JSON-file store for The Desk (the curation queue). Files are the
// truth for the registry; this store is disposable operational state — the
// pending/decided proposal log — mirroring the "Postgres holds only
// operational state" split in docs/DESIGN.md, just as a flat file for v1.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Proposal, ProposalType, Verdict, Wire } from './types';
import { laneFor } from '../proposal-lanes';

const REPO_ROOT = process.cwd();
const DATA_DIR = join(REPO_ROOT, '.data');
const STORE_PATH = join(DATA_DIR, 'desk.json');
const SEED_DIR = join(REPO_ROOT, 'seed');

interface Store {
  proposals: Proposal[];
  verdicts: Verdict[];
}

function emptyStore(): Store {
  return { proposals: [], verdicts: [] };
}

function readStore(): Store {
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

function writeStore(store: Store): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = join(DATA_DIR, `.desk.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  renameSync(tmp, STORE_PATH); // atomic on the same filesystem
}

// ---- id + dedupe ----

function makeIdCounter(store: Store): () => string {
  let max = 0;
  for (const p of store.proposals) {
    const m = /^p(\d+)$/.exec(p.id);
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

// ---- raw miner output (seed/proposals-batch-*.json) ----

interface RawMinerProposal {
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

/** Idempotently import proposals-batch-*.json (miner output) and
 *  resolution_report.json merge_candidates into the store. Safe to call
 *  repeatedly — already-imported items are skipped by dedupe key. */
export function seedFromFiles(): { imported: number; skipped: number } {
  const store = readStore();
  const existingKeys = new Set(store.proposals.map((p) => dedupeKeyOf(p)));
  const nextId = makeIdCounter(store);
  let imported = 0;
  let skipped = 0;

  const batchFiles = existsSync(SEED_DIR)
    ? readdirSync(SEED_DIR)
        .filter((f) => /^proposals-batch-.*\.json$/.test(f))
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
      store.proposals.push(proposal);
      existingKeys.add(key);
      imported++;
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
        store.proposals.push(proposal);
        existingKeys.add(key);
        imported++;
      }
    } catch {
      // malformed resolution report never takes seeding down
    }
  }

  writeStore(store);
  return { imported, skipped };
}

// ---- queue reads ----

export function listProposals(filter?: { lane?: 'judgment' | 'fact'; state?: Proposal['state'] }): Proposal[] {
  const store = readStore();
  return store.proposals.filter(
    (p) => (!filter?.lane || p.lane === filter.lane) && (!filter?.state || p.state === filter.state)
  );
}

export function getProposal(id: string): Proposal | null {
  return readStore().proposals.find((p) => p.id === id) || null;
}

/** Newest first. */
export function listVerdicts(): Verdict[] {
  return readStore().verdicts;
}

export function queueCounts(): { pendingJudgment: number; pendingFact: number; decidedToday: number; total: number } {
  const store = readStore();
  const today = new Date().toISOString().slice(0, 10);
  let pendingJudgment = 0;
  let pendingFact = 0;
  let decidedToday = 0;
  for (const p of store.proposals) {
    if (p.state !== 'pending') continue;
    if (p.lane === 'judgment') pendingJudgment++;
    else pendingFact++;
  }
  for (const v of store.verdicts) {
    if (v.at.slice(0, 10) === today) decidedToday++;
  }
  return { pendingJudgment, pendingFact, decidedToday, total: store.proposals.length };
}

// ---- decisions ----

/** Record a decision already carried out by the caller (committer.ts does the
 *  file mutation + git commit; this just moves the proposal + logs the verdict). */
export function recordVerdict(
  id: string,
  decision: 'approved' | 'rejected',
  opts?: { note?: string; commit?: string | null }
): { proposal: Proposal; verdict: Verdict } {
  const store = readStore();
  const idx = store.proposals.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`proposal not found: ${id}`);
  if (store.proposals[idx].state !== 'pending') throw new Error(`proposal ${id} already decided`);

  const at = new Date().toISOString();
  const proposal: Proposal = { ...store.proposals[idx], state: decision, decided_at: at, decision_note: opts?.note };
  store.proposals[idx] = proposal;
  const verdict: Verdict = { proposal_id: id, decision, note: opts?.note, at, commit: opts?.commit ?? null };
  store.verdicts.unshift(verdict);
  writeStore(store);
  return { proposal, verdict };
}
