// The daily ingest loop (docs/DESIGN.md "Signal flow"): pulls new items from
// the two read-only v1 sources — the wire canonical Postgres (`scan_entries`)
// and discuss.watch's pre-classified grants feed — resolves each item's org
// deterministically against the registry (no LLM anywhere in this file),
// maps qualifying items to typed Desk proposals, inserts them, then runs the
// machine validator so routine facts can auto-apply the same day they're
// seen. Both sources are independently fail-soft: one being down never
// blocks the other, and watermarks only advance for a source that actually
// succeeded.
import { Pool } from 'pg';
import { buildOrgDedupeIndex, domainOf, norm, type OrgDedupeIndex } from './proposal-validator';
import { slugify } from './committer';
import {
  getIngestState,
  insertIngestProposals,
  setIngestState,
  withIngestLock,
  type RawMinerProposal,
} from './desk-store';
import { loadRegistry } from './registry';
import { runValidation } from './validation-runner';
import type { Org, Program, Round, Wire } from './types';

const WIRE_DATABASE_URL = process.env.WIRE_DATABASE_URL;
// NOT https://discuss.watch/api/v1/grants — verified live (2026-07-11) that the bare
// apex domain 302s to Squarespace, which redirects the WHOLE domain (path dropped) to
// https://www.discuss.watch/, the marketing homepage. The `www` host is the actual
// Next.js app and preserves the path; wire-room-ops's own default (src/config/index.ts)
// bypasses the custom domain entirely and hits the Railway origin
// (discuss-dot-watch-production.up.railway.app) for the same reason. No auth/API key
// needed either way — verified against both hosts with no credentials.
const DISCUSS_WATCH_GRANTS_URL = process.env.DISCUSS_WATCH_GRANTS_URL || 'https://www.discuss.watch/api/v1/grants';

const WIRE_STATUS_FILTER = ['approved', 'queued'];
const WIRE_BACKFILL_DAYS = 180;
const WIRE_PER_RUN_LIMIT = 1000;
const WIRE_BACKFILL_LIMIT = 10_000;

const DISCUSS_PAGE_LIMIT = 100;
const DISCUSS_MAX_PAGES_INCREMENTAL = 20; // 2,000 items/run safety cap
const DISCUSS_MAX_PAGES_BACKFILL = 100; // 10,000 items safety cap for "from its beginning"

const CONFIDENCE_FLOOR = 55;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================
// wire-room-ops canonical Postgres (scan_entries + org_profiles)
// ============================================================

interface WireRow {
  id: number;
  name: string;
  description: string | null;
  source_url: string;
  amount: string | null;
  deadline: string | null;
  deadline_iso: string | null; // to_char(deadline_parsed, 'YYYY-MM-DD') — reliable, beyond the free-text `deadline` column
  wire: string;
  status: string;
  quality_score: number | null;
  enriched_summary: string | null;
  classification: string | null;
  org_id: number | null;
  tags: string[] | null;
  // Selected via to_char(... 'US') as a full-microsecond-precision string, NOT the raw
  // timestamptz column — pg's default driver parses timestamptz into a JS Date, which
  // only holds millisecond precision, so a watermark round-tripped through `new Date()`
  // silently truncates any real microsecond component Postgres stored. Found live
  // (2026-07-11): that truncation made the watermark's own boundary row satisfy
  // `created_at > watermark` again on the very next run (the DB's true value being
  // >.000ms past the truncated watermark), so the last row re-fetched forever and the
  // watermark never actually advanced. Keeping this as the untouched source string end
  // to end (query param AND stored watermark) avoids the round-trip entirely.
  created_at: string;
  source_published_at: string | null;
  org_name: string | null;
  org_website: string | null;
  org_aliases: string[] | null;
}

let wirePool: Pool | null = null;
function getWirePool(): Pool | null {
  if (!WIRE_DATABASE_URL) return null;
  // No explicit ssl override, mirroring desk-store.ts / scripts/load-registry-pg.mjs:
  // pg's default TLS behavior (and any sslmode= in the connection string) applies as-is.
  if (!wirePool) wirePool = new Pool({ connectionString: WIRE_DATABASE_URL });
  return wirePool;
}

const WIRE_SELECT = `
  SELECT se.id, se.name, se.description, se.source_url, se.amount, se.deadline,
         to_char(se.deadline_parsed, 'YYYY-MM-DD') AS deadline_iso,
         se.wire, se.status, se.quality_score, se.enriched_summary, se.classification,
         se.org_id, se.tags, se.source_published_at,
         to_char(se.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
         op.name AS org_name, op.website AS org_website, op.aliases AS org_aliases
  FROM scan_entries se
  LEFT JOIN org_profiles op ON op.id = se.org_id
`;

export interface WireWatermark {
  last_created_at: string;
  last_id: number;
}

/** Fetches new-since-watermark wire rows (or, in backfill mode, everything
 *  from the last 180 days), joined to org_profiles so a set org_id resolves
 *  straight to a name/website/aliases. Never throws — a connection or query
 *  failure comes back as { rows: [], error }, the fail-soft contract every
 *  caller in this file relies on. */
async function fetchWireEntries(opts: {
  backfill: boolean;
  watermark: WireWatermark | null;
}): Promise<{ rows: WireRow[]; error: string | null }> {
  const pool = getWirePool();
  if (!pool) return { rows: [], error: 'WIRE_DATABASE_URL not set' };
  try {
    const statusParams = WIRE_STATUS_FILTER.map((_, i) => `$${i + 1}`).join(', ');
    let query: string;
    let params: unknown[];
    if (opts.backfill) {
      query = `${WIRE_SELECT}
        WHERE se.status IN (${statusParams})
          AND se.created_at >= now() - interval '${WIRE_BACKFILL_DAYS} days'
        ORDER BY se.created_at ASC, se.id ASC
        LIMIT $${WIRE_STATUS_FILTER.length + 1}`;
      params = [...WIRE_STATUS_FILTER, WIRE_BACKFILL_LIMIT];
    } else {
      const lastCreatedAt = opts.watermark?.last_created_at || '1970-01-01T00:00:00.000Z';
      const lastId = opts.watermark?.last_id ?? 0;
      query = `${WIRE_SELECT}
        WHERE se.status IN (${statusParams})
          AND (se.created_at > $${WIRE_STATUS_FILTER.length + 1}
               OR (se.created_at = $${WIRE_STATUS_FILTER.length + 1} AND se.id > $${WIRE_STATUS_FILTER.length + 2}))
        ORDER BY se.created_at ASC, se.id ASC
        LIMIT $${WIRE_STATUS_FILTER.length + 3}`;
      params = [...WIRE_STATUS_FILTER, lastCreatedAt, lastId, WIRE_PER_RUN_LIMIT];
    }
    const { rows } = await pool.query(query, params);
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'wire query failed' };
  }
}

// ============================================================
// discuss.watch pre-classified grants feed
// ============================================================

interface DiscussItem {
  id: number;
  name?: string | null;
  title?: string | null;
  url: string;
  wire?: string | null;
  protocol?: string | null;
  confidence?: number | null;
  program?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  currency?: string | null;
  deadline?: string | null;
  status?: string | null;
  applyUrl?: string | null;
  excerpt?: string | null;
  topicCreatedAt?: string | null;
  firstSeenAt?: string | null;
}

interface DiscussFeedResponse {
  items?: DiscussItem[];
  meta?: { count?: number; nextCursor?: number | null };
  error?: string;
}

/** Paginates GET .../grants via its cursor (id-descending pages; nextCursor
 *  null means exhausted). Non-backfill passes `since` (a full ISO timestamp
 *  — confirmed live against the feed to filter correctly); backfill omits it
 *  ("from its beginning"). No auth: the live feed takes no API key (verified
 *  against both discuss.watch and its Railway origin — see the report this
 *  ingest loop shipped with). Fails soft: a mid-pagination error returns
 *  whatever pages already landed, with an error string. */
async function fetchDiscussItems(opts: { backfill: boolean; since: string | null }): Promise<{ items: DiscussItem[]; error: string | null }> {
  const items: DiscussItem[] = [];
  let cursor: number | null = null;
  const maxPages = opts.backfill ? DISCUSS_MAX_PAGES_BACKFILL : DISCUSS_MAX_PAGES_INCREMENTAL;
  try {
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ limit: String(DISCUSS_PAGE_LIMIT) });
      if (!opts.backfill && opts.since) params.set('since', opts.since);
      if (cursor != null) params.set('cursor', String(cursor));
      const res = await fetch(`${DISCUSS_WATCH_GRANTS_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { items, error: `discuss.watch returned ${res.status}` };
      const data = (await res.json()) as DiscussFeedResponse;
      if (data.error) return { items, error: data.error };
      if (!Array.isArray(data.items) || data.items.length === 0) break;
      items.push(...data.items);
      const next = data.meta?.nextCursor;
      if (next == null) break;
      cursor = next;
    }
    return { items, error: null };
  } catch (e) {
    return { items, error: e instanceof Error ? e.message : 'discuss.watch fetch failed' };
  }
}

/** "$min–max" / "$max" from amountMin/amountMax/currency, mirroring
 *  wire-room-ops's formatFeedAmount (src/services/forum.ts) — same feed,
 *  same shape, independently reimplemented since it's a separate repo. */
function formatDiscussAmount(item: DiscussItem): string | null {
  const max = item.amountMax ?? item.amountMin;
  if (max == null || !Number.isFinite(max)) return null;
  const min = item.amountMin;
  const fmt = (n: number) => n.toLocaleString('en-US');
  const range = min != null && Number.isFinite(min) && min !== max ? `${fmt(min)}–${fmt(max)}` : fmt(max);
  const currency = (item.currency || '').trim().toUpperCase();
  return !currency || currency === 'USD' ? `$${range}` : `${range} ${currency}`;
}

// wire-room-ops's scan_entries.description/enriched_summary occasionally
// holds a raw, unfilled LLM prompt template rather than generated prose —
// a bug in that pipeline's auto-summarize path, not this one (confirmed
// live 2026-07-11: 527 of 1,196 approved/queued rows, ~44%, contain this).
// Nothing in the machine validator checks prose quality — only structured
// fields (status/mechanism/apply_url/rounds) have shape/enum checks — so
// unfiltered, a corrupt summary would sail straight through an auto-approved
// new_program/profile_note into a public-facing registry file (it did,
// during this loop's own smoke test, before this filter existed). Refuse
// text that smells like an unfilled prompt; fall back to a plain sentence
// built only from fields we trust (org/program name, source).
const PROMPT_ARTIFACT_PATTERNS = [
  /we need (to )?(produce|write)/i,
  /\bconcise\b[^.]{0,40}\bnewsletter\b/i,
  /no bullet points/i,
  /no fluff/i,
  /no hype words/i,
  /must be \d-\d sentences/i,
  /^we have:/im,
];

function looksLikePromptArtifact(text: string): boolean {
  return PROMPT_ARTIFACT_PATTERNS.some((re) => re.test(text));
}

/** Trims to 600 chars and falls back to `fallback` when `candidate` is
 *  empty or trips looksLikePromptArtifact. */
function safeSummary(candidate: string | null | undefined, fallback: string): string {
  const text = (candidate || '').trim();
  if (!text || looksLikePromptArtifact(text)) return fallback;
  return text.slice(0, 600);
}

// ============================================================
// shared mapping helpers
// ============================================================

function normalizeWire(w: string | null | undefined): Wire | null {
  return w === 'crypto' || w === 'ai' || w === 'oss' ? w : null;
}

/** First 10 chars if they parse as YYYY-MM-DD, else null — never passes
 *  through a non-ISO string as though it were a checkable date literal
 *  (proposal-validator's findDateLiterals only recognizes that exact shape). */
function isoDateOnly(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = String(s).slice(0, 10);
  return ISO_DATE_RE.test(d) ? d : null;
}

/** Which existing round a fact-type update should target. Zero rounds on
 *  file: safe to create one under a stable generic name so repeat updates to
 *  the same program keep re-targeting it. Exactly one: target it by its real
 *  name (mergeRounds matches on name). Two or more: which round the new
 *  deadline belongs to is genuinely ambiguous from a wire/forum signal alone
 *  — never guess, the caller drops the candidate instead. */
function pickRoundName(existingRounds: Round[]): string | null {
  if (existingRounds.length === 0) return 'Rolling';
  if (existingRounds.length === 1) return existingRounds[0].name;
  return null;
}

/** Exact normalized match first, then a loose substring match either
 *  direction — the same fallback resolveProgramSlug (committer.ts) uses when
 *  approving a hand-shaped fact proposal, so a wire-mapped one resolves the
 *  same way a human-authored one would. */
function matchProgram(nameCandidate: string | null, candidates: Program[]): Program | null {
  if (!nameCandidate) return null;
  const n = norm(nameCandidate);
  if (!n) return null;
  const exact = candidates.find((p) => norm(p.name) === n);
  if (exact) return exact;
  return candidates.find((p) => norm(p.name).includes(n) || n.includes(norm(p.name))) || null;
}

/** Domain candidates first (strong signal), then name candidates — mirrors
 *  proposal-validator's findDuplicateOrg, generalized to accept several
 *  candidate domains/names per item (a wire row can offer both the linked
 *  org_profiles.website and the entry's own source_url domain). */
function resolveOrg(index: OrgDedupeIndex, domains: (string | null | undefined)[], names: (string | null | undefined)[]): Org | null {
  for (const raw of domains) {
    const d = domainOf(raw);
    if (d && index.byDomain.has(d)) return index.byDomain.get(d)!;
  }
  for (const raw of names) {
    if (!raw) continue;
    const key = norm(raw);
    if (key && index.byName.has(key)) return index.byName.get(key)!;
  }
  return null;
}

interface MapContext {
  index: OrgDedupeIndex;
  programs: Program[];
}

interface MapOutcome {
  candidate: RawMinerProposal | null;
  /** true when the item was a real signal that just didn't clear the bar for
   *  a proposal (vague, ambiguous, or genuinely just news) — counted in
   *  IngestResult.dropped. Both fields false/null means the item was
   *  filtered before mapping (e.g. no wire) and isn't counted either way. */
  dropped: boolean;
}

const NO_OUTCOME: MapOutcome = { candidate: null, dropped: false };
const DROPPED: MapOutcome = { candidate: null, dropped: true };

/** Shared decision tree for both sources once they're reduced to a common
 *  shape (an org resolver already tried, a program-name candidate, an
 *  optional ISO deadline, an amount string, an optional apply/website URL).
 *  Mirrors docs/DESIGN.md's "Signal flow" table:
 *    resolved org, program name matches an existing program  -> deadline_change
 *      on that program (only when a dated deadline is present — otherwise
 *      there's no new fact to add, so it's dropped as vague)
 *    resolved org, program name names something NOT on file   -> new_program
 *    resolved org, no usable program name at all               -> dropped (vague)
 *    unresolved org, a plausible org name + evidence url       -> new_org
 *    unresolved org, no plausible org name                     -> dropped
 */
function decide(input: {
  org: Org | null;
  orgNameCandidate: string | null;
  orgWebsiteGuess: string | null;
  programNameCandidate: string | null;
  deadline: string | null;
  amount: string | null;
  evidenceUrl: string;
  wire: Wire | null;
  confidence: number;
  signalId: string;
  summary: string;
  programs: Program[];
}): MapOutcome {
  const { org, programNameCandidate, deadline, amount, evidenceUrl, wire, confidence, signalId, summary, programs } = input;

  if (org) {
    const orgPrograms = programs.filter((p) => p.org === org.id);
    const programMatch = matchProgram(programNameCandidate, orgPrograms);

    if (programMatch) {
      if (!deadline) return DROPPED; // matched an existing program but nothing new/dated to say
      const roundName = pickRoundName(programMatch.rounds || []);
      if (!roundName) return DROPPED; // ambiguous which round this deadline belongs to
      const round: Record<string, unknown> = { name: roundName, closes: deadline, source: evidenceUrl };
      if (amount) round.size = amount;
      return {
        dropped: false,
        candidate: {
          type: 'deadline_change',
          org: org.id,
          org_name: org.name,
          program: programMatch.name,
          title: `${org.name} — ${programMatch.name}: deadline ${deadline}`,
          summary,
          evidence_url: evidenceUrl,
          proposed_change: { [`programs/${programMatch.id}.yaml`]: { rounds: [round] } },
          confidence,
          signal_id: signalId,
          wire,
        },
      };
    }

    if (programNameCandidate && programNameCandidate.trim().length >= 3) {
      const slug = slugify(programNameCandidate);
      if (!slug) return DROPPED;
      const payload: Record<string, unknown> = { id: slug, name: programNameCandidate, org: org.id };
      if (input.orgWebsiteGuess) payload.apply_url = input.orgWebsiteGuess;
      else if (deadline) payload.apply_url = evidenceUrl;
      if (deadline) {
        const round: Record<string, unknown> = { name: 'Rolling', status: 'open', closes: deadline, source: evidenceUrl };
        if (amount) round.size = amount;
        payload.rounds = [round];
      }
      return {
        dropped: false,
        candidate: {
          type: 'new_program',
          org: org.id,
          org_name: org.name,
          program: programNameCandidate,
          title: `${org.name} — ${programNameCandidate}`,
          summary,
          evidence_url: evidenceUrl,
          proposed_change: { [`programs/${slug}.yaml`]: payload },
          confidence,
          signal_id: signalId,
          wire,
        },
      };
    }

    return DROPPED; // resolved org, nothing specific enough to say about it — vague, skip
  }

  // unresolved org
  const plausibleName = input.orgNameCandidate;
  if (plausibleName && evidenceUrl) {
    const slug = slugify(plausibleName);
    if (!slug) return DROPPED;
    const payload: Record<string, unknown> = {
      id: slug,
      name: plausibleName,
      wires: wire ? [wire] : [],
      roles: ['funder'],
      status: 'active',
    };
    if (input.orgWebsiteGuess) payload.website = input.orgWebsiteGuess;
    return {
      dropped: false,
      candidate: {
        type: 'new_org',
        org: null,
        org_name: plausibleName,
        title: `${plausibleName} — new org signal (${wire || 'unknown wire'})`,
        summary,
        evidence_url: evidenceUrl,
        proposed_change: { [`orgs/${slug}.yaml`]: payload },
        confidence,
        signal_id: signalId,
        wire,
      },
    };
  }

  return DROPPED; // no org_id/protocol at all — no plausible org name to build anything from
}

function mapWireRow(row: WireRow, ctx: MapContext): MapOutcome {
  const wire = normalizeWire(row.wire);
  const evidenceUrl = row.source_url;
  if (!evidenceUrl) return NO_OUTCOME;

  const confidence = Math.max(CONFIDENCE_FLOOR, row.quality_score ?? 0);
  const deadline = isoDateOnly(row.deadline_iso) || isoDateOnly(row.deadline);
  const amount = row.amount ? row.amount.trim() || null : null;
  const programNameCandidate = (row.name || '').trim() || null;
  const summaryFallback = `${programNameCandidate || row.name || 'Wire signal'} — dispatch from the wire, no further detail on file.`;
  const summary = safeSummary(row.enriched_summary || row.description, summaryFallback);

  // Resolution only has real signal when org_id is set (org_profiles.name/
  // website/aliases) or the entry's own source_url happens to sit on a
  // known org's domain. Without org_id there is no plausible org NAME to
  // fall back on (the entry's `name` is the opportunity title, not an org
  // name) — such rows can still resolve by domain, but can never become a
  // new_org candidate; that's an honest limitation of the columns available.
  const domainCandidates = [row.org_website, evidenceUrl];
  const nameCandidates = row.org_id != null ? [row.org_name, ...(row.org_aliases || [])] : [];
  const org = resolveOrg(ctx.index, domainCandidates, nameCandidates);

  return decide({
    org,
    orgNameCandidate: row.org_id != null ? row.org_name : null,
    orgWebsiteGuess: row.org_website || null,
    programNameCandidate,
    deadline,
    amount,
    evidenceUrl,
    wire,
    confidence,
    signalId: `wire:${row.id}`,
    summary,
    programs: ctx.programs,
  });
}

function mapDiscussItem(item: DiscussItem, ctx: MapContext): MapOutcome {
  const wire = normalizeWire(item.wire);
  const evidenceUrl = item.url;
  if (!evidenceUrl) return NO_OUTCOME;

  const title = (item.title || item.name || '').trim();
  const programNameCandidate = (item.program || title || '').trim() || null;
  const orgNameCandidate = (item.protocol || '').trim() || null;
  const confidence = Math.max(CONFIDENCE_FLOOR, item.confidence ?? 0);
  const deadline = isoDateOnly(item.deadline);
  const amount = formatDiscussAmount(item);
  const summaryFallback = `${title || orgNameCandidate || 'A funder'} — funding signal from discuss.watch, no further detail on file.`;
  const summary = safeSummary(item.excerpt || title, summaryFallback);

  // applyUrl (when present) is the org's own "apply here" link, a much
  // better domain signal than the forum thread URL — tried first.
  const org = resolveOrg(ctx.index, [item.applyUrl, item.url], [orgNameCandidate]);

  return decide({
    org,
    orgNameCandidate,
    orgWebsiteGuess: item.applyUrl || null,
    programNameCandidate,
    deadline,
    amount,
    evidenceUrl,
    wire,
    confidence,
    signalId: `discuss:${item.id}`,
    summary,
    programs: ctx.programs,
  });
}

// ============================================================
// orchestration
// ============================================================

export interface IngestOptions {
  backfill?: boolean;
  validationLimit?: number;
}

export interface IngestResult {
  source_counts: {
    wire: { fetched: number; error: string | null };
    discuss: { fetched: number; error: string | null };
  };
  proposals_created: number;
  deduped: number;
  dropped: number;
  validation: { passed: number; failed: number };
  watermarks: { wire_scan_entries: unknown; discuss_grants: unknown };
  errors: string[];
}

/** Runs one full ingest cycle: fetch both sources (independently fail-soft),
 *  map deterministically to proposal candidates, insert (store-level dedupe
 *  does the rest), run the machine validator, and advance each source's
 *  watermark only if that source's own fetch succeeded AND the insert step
 *  as a whole succeeded — a store outage must never silently advance a
 *  watermark past signals that were never actually persisted. */
export async function runIngest(opts: IngestOptions = {}): Promise<IngestResult> {
  const backfill = opts.backfill === true;
  const errors: string[] = [];
  const { orgs, programs } = loadRegistry();
  const ctx: MapContext = { index: buildOrgDedupeIndex(orgs), programs };

  const candidates: RawMinerProposal[] = [];
  let dropped = 0;

  // ---- wire ----
  const wireWatermarkRaw = await getIngestState('wire_scan_entries');
  const wireWatermark = (wireWatermarkRaw && typeof wireWatermarkRaw === 'object' ? (wireWatermarkRaw as WireWatermark) : null);
  const { rows: wireRows, error: wireError } = await fetchWireEntries({ backfill, watermark: backfill ? null : wireWatermark });
  if (wireError) errors.push(`wire: ${wireError}`);
  for (const row of wireRows) {
    const outcome = mapWireRow(row, ctx);
    if (outcome.candidate) candidates.push(outcome.candidate);
    else if (outcome.dropped) dropped++;
  }
  const wireWatermarkCandidate: WireWatermark | null =
    !wireError && wireRows.length > 0
      ? { last_created_at: wireRows[wireRows.length - 1].created_at, last_id: wireRows[wireRows.length - 1].id }
      : null;

  // ---- discuss.watch ----
  const discussWatermarkRaw = await getIngestState('discuss_grants');
  const discussWatermarkObj =
    discussWatermarkRaw && typeof discussWatermarkRaw === 'object' ? (discussWatermarkRaw as { since?: unknown; last_id?: unknown }) : null;
  const discussSince = typeof discussWatermarkObj?.since === 'string' ? discussWatermarkObj.since : null;
  const discussLastId = typeof discussWatermarkObj?.last_id === 'number' ? discussWatermarkObj.last_id : null;

  const { items: discussItemsRaw, error: discussError } = await fetchDiscussItems({ backfill, since: backfill ? null : discussSince });
  if (discussError) errors.push(`discuss: ${discussError}`);
  // The feed's `since` is INCLUSIVE (verified live 2026-07-11: since=<an item's own
  // firstSeenAt> returns that same item), so without this filter the boundary item
  // would re-satisfy `since` and get "fetched" again on every subsequent run forever,
  // the same failure shape the wire watermark had before its own id tie-break fix.
  // Client-side id filter closes it: an id we've already advanced past is never
  // reprocessed, regardless of what the server's inclusive boundary hands back.
  const discussItems = !backfill && discussLastId != null ? discussItemsRaw.filter((it) => it.id > discussLastId) : discussItemsRaw;
  for (const item of discussItems) {
    const outcome = mapDiscussItem(item, ctx);
    if (outcome.candidate) candidates.push(outcome.candidate);
    else if (outcome.dropped) dropped++;
  }
  const discussWatermarkCandidate: { since: string; last_id: number } | null = (() => {
    if (discussError || discussItems.length === 0) return null;
    let maxSince = discussSince || '';
    let maxId = discussLastId ?? 0;
    for (const item of discussItems) {
      const t = item.firstSeenAt || item.topicCreatedAt;
      if (t && t > maxSince) maxSince = t;
      if (item.id > maxId) maxId = item.id;
    }
    return maxSince ? { since: maxSince, last_id: maxId } : null;
  })();

  // ---- insert (store-level dedupe: signal ref + type/org/program) ----
  let insertOk = false;
  let inserted: { inserted: RawMinerProposal[]; skipped: number } | null = null;
  try {
    const result = await insertIngestProposals(candidates);
    inserted = { inserted: result.inserted, skipped: result.skipped };
    insertOk = true;
  } catch (e) {
    errors.push(`insert failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  }

  // ---- advance watermarks (only for a source that fetched cleanly AND only if the insert succeeded) ----
  const watermarks: IngestResult['watermarks'] = {
    wire_scan_entries: wireWatermarkRaw ?? null,
    discuss_grants: discussWatermarkRaw ?? null,
  };
  if (insertOk) {
    if (wireWatermarkCandidate) {
      try {
        await setIngestState('wire_scan_entries', wireWatermarkCandidate);
        watermarks.wire_scan_entries = wireWatermarkCandidate;
      } catch (e) {
        errors.push(`wire watermark write failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
    if (discussWatermarkCandidate) {
      try {
        await setIngestState('discuss_grants', discussWatermarkCandidate);
        watermarks.discuss_grants = discussWatermarkCandidate;
      } catch (e) {
        errors.push(`discuss watermark write failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
  }

  // ---- machine validation (same pipeline The Desk's "Run validation" button uses) ----
  let validation = { passed: 0, failed: 0 };
  try {
    const result = await runValidation({ limit: opts.validationLimit });
    validation = { passed: result.passed, failed: result.failed };
  } catch (e) {
    errors.push(`validation run failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  }

  return {
    source_counts: {
      wire: { fetched: wireRows.length, error: wireError },
      discuss: { fetched: discussItems.length, error: discussError },
    },
    proposals_created: insertOk ? inserted!.inserted.length : 0,
    deduped: insertOk ? inserted!.skipped : 0,
    dropped,
    validation,
    watermarks,
    errors,
  };
}

// ============================================================
// scheduler (src/instrumentation.ts, INGEST_ENABLED=1)
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const JITTER_MS = 30 * 60 * 1000; // ±30 min
const INITIAL_DELAY_MS = (1 + Math.random() * 9) * 60 * 1000; // fire once 1-10 min after boot

function nextDelay(): number {
  return DAY_MS + (Math.random() * 2 - 1) * JITTER_MS;
}

let timerStarted = false;

/** Starts the daily in-process ingest timer. Idempotent within a process
 *  (repeated calls are no-ops) — instrumentation.ts's register() may run
 *  more than once in dev, and this must never stack timers. Cross-process/
 *  cross-instance double-running (the real risk on Railway, where every
 *  replica boots this the same way) is prevented by withIngestLock's pg
 *  advisory lock, not by anything here. */
export function startDailyIngestTimer(): void {
  if (timerStarted) return;
  timerStarted = true;

  const tick = async () => {
    try {
      const { ran, result } = await withIngestLock(() => runIngest({}));
      const at = new Date().toISOString();
      await setIngestState('last_run', ran ? { at, skipped_lock: false, ...result } : { at, skipped_lock: true });
    } catch (e) {
      try {
        await setIngestState('last_run', { at: new Date().toISOString(), error: e instanceof Error ? e.message : 'ingest timer failed' });
      } catch {
        /* best effort — a logging failure must never crash the timer loop */
      }
    } finally {
      const t = setTimeout(tick, nextDelay());
      t.unref?.();
    }
  };

  const t = setTimeout(tick, INITIAL_DELAY_MS);
  t.unref?.();
}
