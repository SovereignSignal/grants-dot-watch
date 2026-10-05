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
import { runWireHandoff, type WireHandoffReport } from './wire-handoff';
import { domainOf, norm } from './proposal-validator';
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
import { buildNewProgramSourceFields } from './ingest-policy';
import { productDateISO } from './round-state';

const WIRE_DATABASE_URL = process.env.WIRE_DATABASE_URL;
// NOT https://discuss.watch/api/v1/grants — verified live (2026-07-11) that the bare
// apex domain 302s to Squarespace, which redirects the WHOLE domain (path dropped) to
// https://www.discuss.watch/, the marketing homepage. The `www` host is the actual
// Next.js app and preserves the path. No auth or API key is required.
const DISCUSS_WATCH_GRANTS_URL = process.env.DISCUSS_WATCH_GRANTS_URL || 'https://www.discuss.watch/api/v1/grants';

const WIRE_STATUS_FILTER = ['approved', 'queued'];
const WIRE_BACKFILL_DAYS = 180;
const WIRE_PER_RUN_LIMIT = 1000;
const WIRE_BACKFILL_LIMIT = 10_000;

const DISCUSS_PAGE_LIMIT = 100;
const DISCUSS_MAX_PAGES_INCREMENTAL = 20; // 2,000 items/run safety cap
const DISCUSS_MAX_PAGES_BACKFILL = 100; // 10,000 items safety cap for "from its beginning"
/** Forum threads older than this are historical unless a deadline is still ahead. */
export const DISCUSS_THREAD_MAX_AGE_DAYS = 90;
const DISCUSS_THREAD_MAX_AGE_MS = DISCUSS_THREAD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

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
  // `wire_area` is being added upstream and may be absent. Read through
  // to_jsonb so a missing column stays null instead of failing the query.
  // 3 (or null) is the only area grants.watch accepts: an open funding program.
  wire_area: string | number | null;
  // relationship_signal lives on operator_route / metadata, not classification.
  operator_route: string | null;
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
         op.name AS org_name, op.website AS org_website, op.aliases AS org_aliases,
         COALESCE(to_jsonb(se)->>'wire_area', to_jsonb(se)->'metadata'->>'wire_area') AS wire_area,
         COALESCE(
           to_jsonb(se)->>'operator_route',
           to_jsonb(se)->'metadata'->>'operator_route',
           to_jsonb(se)->'metadata'->'curator'->>'route'
         ) AS operator_route
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

export interface DiscussItem {
  id: number;
  name?: string | null;
  title?: string | null;
  url: string;
  wire?: string | null;
  classification?: string | null;
  kind?: string | null;
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
  items?: unknown[];
  meta?: { count?: number; nextCursor?: number | null };
  error?: string;
}

export interface DiscussQuarantineItem {
  id: number | null;
  reason: string;
}

export interface DiscussBoundary {
  since: string;
  last_id: number;
}

export interface DiscussPendingWindow {
  mode: 'incremental' | 'backfill';
  since: string | null;
  next_cursor: number;
  max_seen: DiscussBoundary | null;
}

export interface DiscussWatermark {
  since?: string;
  last_id?: number;
  pending?: DiscussPendingWindow;
}

export interface DiscussFetchResult {
  items: DiscussItem[];
  error: string | null;
  /** True only when the API explicitly ended the cursor chain. */
  exhausted: boolean;
  /** Cursor to persist and resume when a safety cap stops this run. */
  nextCursor: number | null;
  quarantined: DiscussQuarantineItem[];
  quarantinedCount: number;
  policyFiltered: DiscussQuarantineItem[];
  policyFilteredCount: number;
  policyReasons: Record<string, number>;
  /** Newest valid timestamp/id pair seen, including malformed item bodies. */
  maxSeen: DiscussBoundary | null;
}

interface DiscussWindow {
  mode: 'incremental' | 'backfill';
  since: string | null;
  cursor: number | null;
  maxSeen: DiscussBoundary | null;
}

const OPTIONAL_DISCUSS_STRINGS = [
  'name',
  'title',
  'wire',
  'classification',
  'kind',
  'protocol',
  'program',
  'currency',
  'deadline',
  'status',
  'applyUrl',
  'excerpt',
  'topicCreatedAt',
  'firstSeenAt',
] as const;

const OPTIONAL_DISCUSS_NUMBERS = ['confidence', 'amountMin', 'amountMax'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function asIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function rawDiscussBoundary(value: unknown): DiscussBoundary | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || (value.id as number) < 0) return null;
  const since = asIsoTimestamp(value.firstSeenAt) || asIsoTimestamp(value.topicCreatedAt);
  return since ? { since, last_id: value.id as number } : null;
}

export function laterDiscussBoundary(a: DiscussBoundary | null, b: DiscussBoundary | null): DiscussBoundary | null {
  if (!a) return b;
  if (!b) return a;
  if (a.since !== b.since) return a.since > b.since ? a : b;
  return a.last_id >= b.last_id ? a : b;
}

/** Runtime contract for an untrusted feed item. A bad record is isolated and
 *  reported instead of being allowed to throw while the rest of the page is
 *  mapped. */
export function parseDiscussItem(value: unknown): { item: DiscussItem | null; reason: string | null } {
  if (!isRecord(value)) return { item: null, reason: 'item is not an object' };
  if (!Number.isSafeInteger(value.id) || (value.id as number) < 0) {
    return { item: null, reason: 'id must be a non-negative safe integer' };
  }
  if (typeof value.url !== 'string' || !validHttpUrl(value.url)) {
    return { item: null, reason: 'url must be an absolute http(s) URL' };
  }

  for (const field of OPTIONAL_DISCUSS_STRINGS) {
    const candidate = value[field];
    if (candidate !== undefined && candidate !== null && typeof candidate !== 'string') {
      return { item: null, reason: `${field} must be a string or null` };
    }
  }
  for (const field of OPTIONAL_DISCUSS_NUMBERS) {
    const candidate = value[field];
    if (candidate !== undefined && candidate !== null && (typeof candidate !== 'number' || !Number.isFinite(candidate))) {
      return { item: null, reason: `${field} must be a finite number or null` };
    }
  }
  if (typeof value.confidence === 'number' && (value.confidence < 0 || value.confidence > 100)) {
    return { item: null, reason: 'confidence must be between 0 and 100' };
  }
  for (const field of ['amountMin', 'amountMax'] as const) {
    if (typeof value[field] === 'number' && value[field] < 0) {
      return { item: null, reason: `${field} must be non-negative` };
    }
  }
  if (typeof value.amountMin === 'number' && typeof value.amountMax === 'number' && value.amountMax < value.amountMin) {
    return { item: null, reason: 'amountMax must be greater than or equal to amountMin' };
  }
  if (typeof value.applyUrl === 'string' && value.applyUrl && !validHttpUrl(value.applyUrl)) {
    return { item: null, reason: 'applyUrl must be an absolute http(s) URL or null' };
  }
  for (const field of ['topicCreatedAt', 'firstSeenAt'] as const) {
    if (typeof value[field] === 'string' && value[field] && asIsoTimestamp(value[field]) === null) {
      return { item: null, reason: `${field} must be a valid timestamp or null` };
    }
  }
  if (!asIsoTimestamp(value.firstSeenAt) && !asIsoTimestamp(value.topicCreatedAt)) {
    return { item: null, reason: 'firstSeenAt or topicCreatedAt is required' };
  }
  if (typeof value.deadline === 'string' && value.deadline && isoDateOnly(value.deadline) === null) {
    return { item: null, reason: 'deadline must be a real ISO calendar date or null' };
  }

  return { item: value as unknown as DiscussItem, reason: null };
}

function policyToken(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const APPLICANT_SIGNAL_TOKENS = new Set(['applicant', 'applicant_observation', 'application', 'grant_application', 'proposal']);
const CLOSED_SIGNAL_TOKENS = new Set(['closed', 'completed', 'ended', 'expired']);

// discuss.watch kind enum. Only an open call belongs on grants.watch.
// program_launch / rfp are the open-program kinds. ROLE (paid work, seats,
// fellowships) is a separate lane and is never ingested.
const OPEN_PROGRAM_KINDS = new Set(['program_launch', 'rfp', 'open_call', 'open_program']);
const ROLE_KINDS = new Set([
  'role', 'full_time', 'part_time', 'contract', 'fractional', 'consulting', 'internship',
  'fellowship', 'residency', 'bounty', 'council_seat', 'steward', 'working_group',
  'election', 'delegate_incentive', 'service_provider',
]);

// Hackathons, prizes, and fellowships are not open grant programs wherever
// they are named. Result and recipient language is normal in an open-call
// summary ("past recipients", "awarded up to $X", "results announced in
// March"), so those three tokens apply to the title only.
const TITLE_AND_SUMMARY_TOKENS: ReadonlyArray<{ token: string; pattern: RegExp }> = [
  { token: 'hackathon', pattern: /\bhackathons?\b/i },
  { token: 'buildathon', pattern: /\bbuildathons?\b/i },
  { token: 'prize', pattern: /\bprizes?\b/i },
  { token: 'fellowship', pattern: /\bfellowships?\b/i },
  { token: 'residency', pattern: /\bresidenc(?:y|ies)\b/i },
];
const TITLE_ONLY_TOKENS: ReadonlyArray<{ token: string; pattern: RegExp }> = [
  { token: 'results', pattern: /\bresults\b/i },
  { token: 'awarded', pattern: /\bawarded\b/i },
  { token: 'recipients', pattern: /\brecipients?\b/i },
];

function applicantSignalReason(classification?: string | null, kind?: string | null, tags: string[] = []): string | null {
  const tokens = [classification, kind, ...tags].map(policyToken).filter(Boolean);
  const matched = tokens.find((token) => APPLICANT_SIGNAL_TOKENS.has(token));
  return matched ? `applicant signal (${matched})` : null;
}

function matchingToken(
  tokens: ReadonlyArray<{ token: string; pattern: RegExp }>,
  text: string
): { token: string } | undefined {
  return tokens.find(({ pattern }) => pattern.test(text));
}

function rejectTokenReason(title: string | null | undefined, summary: string | null | undefined): string | null {
  const headline = title || '';
  const body = summary || '';
  const matched = matchingToken(TITLE_ONLY_TOKENS, headline)
    || matchingToken(TITLE_AND_SUMMARY_TOKENS, `${headline}\n${body}`);
  return matched ? `reject token (${matched.token})` : null;
}

/** Area 3 is an open funding opportunity. A missing area stays eligible
 *  until upstream starts sending the column. Any other present value
 *  (including award/result area 2) is a wire item, not a registry program. */
export function wireAreaAllowsRegistry(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'number') return value === 3;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === 'null') return true;
    return trimmed === '3';
  }
  return false;
}

/** Grants.watch accepts an open grant program: classification GRANT, wire
 *  area 3 or not yet set, and no hackathon/fellowship token in the title or
 *  summary. Result and recipient wording drops the row only when it is in
 *  the title. NEWS, relationship_signal, and every other class drop. */
export function wirePolicyExclusionReason(row: {
  classification?: string | null;
  operator_route?: string | null;
  wire_area?: unknown;
  name?: string | null;
  description?: string | null;
  enriched_summary?: string | null;
  tags?: string[] | null;
}): string | null {
  const applicantReason = applicantSignalReason(row.classification, null, row.tags || []);
  if (applicantReason) return applicantReason;
  const classification = policyToken(row.classification);
  const route = policyToken(row.operator_route);
  const tagHit = (row.tags || []).map(policyToken).find((token) => token === 'relationship_signal');
  if (classification === 'relationship_signal' || route === 'relationship_signal' || tagHit) {
    return 'relationship signal';
  }
  if (classification !== 'grant') return `classification ${classification || 'missing'}`;
  if (!wireAreaAllowsRegistry(row.wire_area)) return `wire_area ${String(row.wire_area).trim()}`;
  return rejectTokenReason(row.name, [row.enriched_summary, row.description].filter(Boolean).join('\n'));
}

/** Applicant submissions are private observations, not evidence that a
 *  funder program should be created or changed. Closed records are historical
 *  observations and cannot establish a current opportunity. discuss.watch
 *  items must be an open-program kind; ROLE is never a registry program. */
export function discussPolicyExclusionReason(item: DiscussItem): string | null {
  const classification = policyToken(item.classification);
  const kind = policyToken(item.kind);
  if (classification === 'role' || ROLE_KINDS.has(kind)) {
    return `role signal (${classification === 'role' ? 'ROLE' : kind})`;
  }
  const applicantReason = applicantSignalReason(item.classification, item.kind);
  if (applicantReason) return applicantReason;
  if (!OPEN_PROGRAM_KINDS.has(kind)) return `not an open program (${kind || 'missing kind'})`;
  const status = policyToken(item.status);
  if (CLOSED_SIGNAL_TOKENS.has(status)) return `non-current status (${status})`;
  const headline = item.title || item.name;
  const summary = [item.title ? item.name : null, item.excerpt].filter(Boolean).join('\n');
  const tokenReason = rejectTokenReason(headline, summary);
  if (tokenReason) return tokenReason;
  if (classification && classification !== 'grant') return `classification ${classification}`;
  return null;
}

// The forum thread's own created/published time. firstSeenAt is when
// discuss.watch stored the row, so a 2024 topic first seen in October 2026
// is still a 2024 thread. topicCreatedAt is the feed's thread date; the
// created/published names cover the same fact when a payload uses them.
const DISCUSS_THREAD_DATE_FIELDS = [
  'topicCreatedAt',
  'createdAt',
  'created_at',
  'created',
  'publishedAt',
  'published_at',
  'published',
] as const;

function discussThreadCreatedMs(item: DiscussItem): number | null {
  const record = item as DiscussItem & Record<string, unknown>;
  for (const field of DISCUSS_THREAD_DATE_FIELDS) {
    const iso = asIsoTimestamp(record[field]);
    if (iso) return Date.parse(iso);
  }
  return null;
}

/** A deadline counts only when isoDateOnly accepts it, and only while that
 *  calendar date is still after the product's today. */
function discussDeadlineStillFuture(deadline: string | null | undefined, now: Date): boolean {
  const date = isoDateOnly(deadline);
  return date !== null && date > productDateISO(now);
}

/** Skip a discuss item whose thread date is older than DISCUSS_THREAD_MAX_AGE_DAYS,
 *  unless its deadline is still in the future. With no thread/created/published
 *  date, the item is left to the open-program gate. */
export function discussThreadAgeExclusionReason(item: DiscussItem, now: Date = new Date()): string | null {
  const createdMs = discussThreadCreatedMs(item);
  if (createdMs === null) return null;
  if (now.getTime() - createdMs <= DISCUSS_THREAD_MAX_AGE_MS) return null;
  if (discussDeadlineStillFuture(item.deadline, now)) return null;
  return `thread older than ${DISCUSS_THREAD_MAX_AGE_DAYS} days`;
}

/** Open-program gate first. Age runs only after that gate passes, so an old
 *  role, reject-token, or non-grant row keeps the gate's existing reason. */
function discussCandidateExclusionReason(item: DiscussItem): string | null {
  return discussPolicyExclusionReason(item) ?? discussThreadAgeExclusionReason(item);
}

/** Paginates GET .../grants via its cursor (id-descending pages; nextCursor
 *  null means exhausted). Non-backfill passes `since` (a full ISO timestamp
 *  — confirmed live against the feed to filter correctly); backfill omits it
 *  ("from its beginning"). No auth: the live feed takes no API key (verified
 *  against both discuss.watch and its Railway origin — see the report this
 *  ingest loop shipped with). Fails soft: a mid-pagination error returns
 *  whatever pages already landed, with an error string. A safety-cap stop is
 *  a distinct incomplete result carrying the next cursor; callers persist it
 *  and resume the same fixed `since` window before advancing their boundary. */
export async function fetchDiscussItems(opts: {
  backfill: boolean;
  since: string | null;
  cursor?: number | null;
  /** Test seam. Production always uses the source-specific constants above. */
  maxPages?: number;
}): Promise<DiscussFetchResult> {
  const items: DiscussItem[] = [];
  const quarantined: DiscussQuarantineItem[] = [];
  const policyFiltered: DiscussQuarantineItem[] = [];
  let quarantinedCount = 0;
  let policyFilteredCount = 0;
  const policyReasons: Record<string, number> = {};
  let maxSeen: DiscussBoundary | null = null;
  let cursor = opts.cursor ?? null;
  const maxPages = opts.maxPages ?? (opts.backfill ? DISCUSS_MAX_PAGES_BACKFILL : DISCUSS_MAX_PAGES_INCREMENTAL);
  if (!Number.isSafeInteger(maxPages) || maxPages <= 0) {
    return {
      items,
      error: 'discuss.watch maxPages must be a positive integer',
      exhausted: false,
      nextCursor: cursor,
      quarantined,
      quarantinedCount,
      policyFiltered,
      policyFilteredCount,
      policyReasons,
      maxSeen,
    };
  }
  try {
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ limit: String(DISCUSS_PAGE_LIMIT) });
      if (!opts.backfill && opts.since) params.set('since', opts.since);
      if (cursor != null) params.set('cursor', String(cursor));
      const res = await fetch(`${DISCUSS_WATCH_GRANTS_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return { items, error: `discuss.watch returned ${res.status}`, exhausted: false, nextCursor: cursor, quarantined, quarantinedCount, policyFiltered, policyFilteredCount, policyReasons, maxSeen };
      }
      const data = (await res.json()) as DiscussFeedResponse;
      if (!isRecord(data)) {
        return { items, error: 'discuss.watch returned a non-object payload', exhausted: false, nextCursor: cursor, quarantined, quarantinedCount, policyFiltered, policyFilteredCount, policyReasons, maxSeen };
      }
      if (typeof data.error === 'string' && data.error) {
        return { items, error: data.error, exhausted: false, nextCursor: cursor, quarantined, quarantinedCount, policyFiltered, policyFilteredCount, policyReasons, maxSeen };
      }
      if (!Array.isArray(data.items)) {
        return { items, error: 'discuss.watch payload is missing items[]', exhausted: false, nextCursor: cursor, quarantined, quarantinedCount, policyFiltered, policyFilteredCount, policyReasons, maxSeen };
      }
      if (data.items.length === 0) {
        return { items, error: null, exhausted: true, nextCursor: null, quarantined, quarantinedCount, policyFiltered, policyFilteredCount, policyReasons, maxSeen };
      }
      for (const raw of data.items) {
        maxSeen = laterDiscussBoundary(maxSeen, rawDiscussBoundary(raw));
        const parsed = parseDiscussItem(raw);
        if (parsed.item) {
          const policyReason = discussCandidateExclusionReason(parsed.item);
          if (policyReason) {
            policyFilteredCount++;
            policyReasons[policyReason] = (policyReasons[policyReason] || 0) + 1;
            if (policyFiltered.length < 100) policyFiltered.push({ id: parsed.item.id, reason: policyReason });
          } else {
            items.push(parsed.item);
          }
        } else {
          quarantinedCount++;
          if (quarantined.length < 100) {
            quarantined.push({ id: isRecord(raw) && Number.isSafeInteger(raw.id) ? (raw.id as number) : null, reason: parsed.reason || 'invalid item' });
          }
        }
      }
      if (data.meta !== undefined && !isRecord(data.meta)) {
        return { items, error: 'discuss.watch returned invalid meta', exhausted: false, nextCursor: cursor, quarantined, quarantinedCount, policyFiltered, policyFilteredCount, policyReasons, maxSeen };
      }
      const next = isRecord(data.meta) ? data.meta.nextCursor : null;
      if (next == null) {
        return { items, error: null, exhausted: true, nextCursor: null, quarantined, quarantinedCount, policyFiltered, policyFilteredCount, policyReasons, maxSeen };
      }
      if (!Number.isSafeInteger(next) || (next as number) < 0) {
        return { items, error: 'discuss.watch returned an invalid nextCursor', exhausted: false, nextCursor: cursor, quarantined, quarantinedCount, policyFiltered, policyFilteredCount, policyReasons, maxSeen };
      }
      const nextCursor = next as number;
      if (nextCursor === cursor) {
        return { items, error: 'discuss.watch cursor did not advance', exhausted: false, nextCursor: cursor, quarantined, quarantinedCount, policyFiltered, policyFilteredCount, policyReasons, maxSeen };
      }
      cursor = nextCursor;
    }
    return { items, error: null, exhausted: false, nextCursor: cursor, quarantined, quarantinedCount, policyFiltered, policyFilteredCount, policyReasons, maxSeen };
  } catch (e) {
    return {
      items,
      error: e instanceof Error ? e.message : 'discuss.watch fetch failed',
      exhausted: false,
      nextCursor: cursor,
      quarantined,
      quarantinedCount,
      policyFiltered,
      policyFilteredCount,
      policyReasons,
      maxSeen,
    };
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

/** Accepts an exact ISO date or the date component of a valid ISO timestamp.
 *  Shape alone is insufficient: 2026-02-29 and 2026-99-99 must never become
 *  proposed facts. */
export function isoDateOnly(s: string | null | undefined): string | null {
  if (!s) return null;
  const value = String(s).trim();
  const d = value.slice(0, 10);
  if (!ISO_DATE_RE.test(d)) return null;
  if (value.length > 10 && (value[10] !== 'T' || asIsoTimestamp(value) === null)) return null;

  const year = Number(d.slice(0, 4));
  const month = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1] ? d : null;
}

/** Preserve only a score the upstream source actually supplied. Unknown,
 *  non-numeric, and out-of-contract values stay unknown instead of being
 *  promoted to an invented floor. */
export function normalizeConfidence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}

/** Which existing round a fact-type update should target. Zero rounds on
 *  file: create a dated `Current call`, never a semantically rolling round.
 *  Repeat updates keep re-targeting that stable name. Exactly one: use its real
 *  name (mergeRounds matches on name). Two or more: which round the new
 *  deadline belongs to is genuinely ambiguous from a wire/forum signal alone
 *  — never guess, the caller drops the candidate instead. */
export function pickRoundName(existingRounds: Round[]): string | null {
  if (existingRounds.length === 0) return 'Current call';
  if (existingRounds.length === 1) return existingRounds[0].name;
  return null;
}

interface ProgramMatch {
  program: Program | null;
  ambiguous: boolean;
}

/** Match only when the selected tier has one result. An exact name wins over
 *  broader substring candidates, while duplicate exact names and ambiguous
 *  substring matches are quarantined instead of depending on registry order. */
function matchProgram(nameCandidate: string | null, candidates: Program[]): ProgramMatch {
  if (!nameCandidate) return { program: null, ambiguous: false };
  const n = norm(nameCandidate);
  if (!n) return { program: null, ambiguous: false };

  const exact = candidates.filter((p) => norm(p.name) === n);
  if (exact.length > 0) {
    return exact.length === 1
      ? { program: exact[0], ambiguous: false }
      : { program: null, ambiguous: true };
  }

  const loose = candidates.filter((p) => {
    const candidateName = norm(p.name);
    return candidateName && (candidateName.includes(n) || n.includes(candidateName));
  });
  return loose.length === 1
    ? { program: loose[0], ambiguous: false }
    : { program: null, ambiguous: loose.length > 1 };
}

export interface IngestOrgIndex {
  byCanonicalName: Map<string, Org[]>;
  byAlias: Map<string, Org[]>;
  byDomain: Map<string, Org[]>;
}

const SHARED_PLATFORM_DOMAINS = new Set([
  'x.com', 'twitter.com', 'github.com', 'discord.gg', 'discord.com',
  't.me', 'telegram.me', 'telegram.org', 'medium.com', 'mirror.xyz',
  'warpcast.com', 'farcaster.xyz', 'youtube.com', 'youtu.be', 'linkedin.com',
  'reddit.com', 'facebook.com', 'instagram.com', 'notion.site', 'linktr.ee',
  'substack.com', 'bsky.app', 'lens.xyz', 'tiktok.com',
]);

function addOrg(index: Map<string, Org[]>, key: string | null, org: Org): void {
  if (!key) return;
  const matches = index.get(key) || [];
  if (!matches.some((candidate) => candidate.id === org.id)) matches.push(org);
  index.set(key, matches);
}

/** Preserve every registry collision. Resolution decides whether a key is
 *  unique; index construction never picks a winner based on file order. */
export function buildIngestOrgIndex(orgs: Org[]): IngestOrgIndex {
  const byCanonicalName = new Map<string, Org[]>();
  const byAlias = new Map<string, Org[]>();
  const byDomain = new Map<string, Org[]>();

  for (const org of orgs) {
    addOrg(byCanonicalName, norm(org.name), org);
    for (const alias of org.aka || []) addOrg(byAlias, norm(alias), org);

    const socialUrls = org.socials ? Object.values(org.socials) : [];
    for (const url of [org.website, ...socialUrls]) {
      const domain = domainOf(url);
      if (domain && !SHARED_PLATFORM_DOMAINS.has(domain)) addOrg(byDomain, domain, org);
    }
  }

  return { byCanonicalName, byAlias, byDomain };
}

interface OrgMatch {
  org: Org | null;
  ambiguous: boolean;
  tier: 'canonical name' | 'alias' | 'domain' | null;
}

function matchesAtTier(index: Map<string, Org[]>, keys: string[]): Org[] {
  const matches = new Map<string, Org>();
  for (const key of keys) {
    for (const org of index.get(key) || []) matches.set(org.id, org);
  }
  return [...matches.values()];
}

/** Resolve by the strongest available tier: canonical name, unique alias,
 *  then unique domain. If the selected tier points at multiple orgs, stop
 *  there and quarantine the item rather than falling through or picking the
 *  first registry entry. */
function resolveOrg(
  index: IngestOrgIndex,
  domains: (string | null | undefined)[],
  names: (string | null | undefined)[]
): OrgMatch {
  const nameKeys = [...new Set(names.map((raw) => norm(raw || '')).filter(Boolean))];
  const domainKeys = [...new Set(domains.map((raw) => domainOf(raw)).filter((value): value is string => Boolean(value)))];
  const tiers: Array<{ name: OrgMatch['tier']; matches: Org[] }> = [
    { name: 'canonical name', matches: matchesAtTier(index.byCanonicalName, nameKeys) },
    { name: 'alias', matches: matchesAtTier(index.byAlias, nameKeys) },
    { name: 'domain', matches: matchesAtTier(index.byDomain, domainKeys) },
  ];

  for (const tier of tiers) {
    if (tier.matches.length === 0) continue;
    if (tier.matches.length === 1) return { org: tier.matches[0], ambiguous: false, tier: tier.name };
    return { org: null, ambiguous: true, tier: tier.name };
  }
  return { org: null, ambiguous: false, tier: null };
}

interface MapContext {
  index: IngestOrgIndex;
  programs: Program[];
}

interface MapOutcome {
  candidate: RawMinerProposal | null;
  /** true when the item was a real signal that just didn't clear the bar for
   *  a proposal (vague, ambiguous, or genuinely just news) — counted in
   *  IngestResult.dropped. Both fields false/null means the item was
   *  filtered before mapping (e.g. no wire) and isn't counted either way. */
  dropped: boolean;
  dropReason?: string;
}

const NO_OUTCOME: MapOutcome = { candidate: null, dropped: false };
const DROPPED: MapOutcome = { candidate: null, dropped: true };

function policyDropped(reason: string): MapOutcome {
  return { candidate: null, dropped: true, dropReason: reason };
}

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
export function decide(input: {
  org: Org | null;
  orgNameCandidate: string | null;
  orgWebsiteGuess: string | null;
  programApplyUrl: string | null;
  programNameCandidate: string | null;
  deadline: string | null;
  amount: string | null;
  evidenceUrl: string;
  wire: Wire | null;
  confidence?: number;
  signalId: string;
  summary: string;
  programs: Program[];
}): MapOutcome {
  const { org, programNameCandidate, deadline, amount, evidenceUrl, wire, confidence, signalId, summary, programs } = input;

  if (org) {
    const orgPrograms = programs.filter((p) => p.org === org.id);
    const programResolution = matchProgram(programNameCandidate, orgPrograms);
    if (programResolution.ambiguous) return policyDropped('ambiguous program identity');
    const programMatch = programResolution.program;

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
          title: `${org.name} · ${programMatch.name}: deadline ${deadline}`,
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
      const payload: Record<string, unknown> = {
        id: slug,
        name: programNameCandidate,
        org: org.id,
        ...buildNewProgramSourceFields({
          orgWebsite: input.orgWebsiteGuess,
          applicationUrl: input.programApplyUrl,
          evidenceUrl,
          deadline,
          amount,
        }),
      };
      return {
        dropped: false,
        candidate: {
          type: 'new_program',
          org: org.id,
          org_name: org.name,
          program: programNameCandidate,
          title: `${org.name} · ${programNameCandidate}`,
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
        title: `${plausibleName}: new org signal (${wire || 'unknown wire'})`,
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

export function mapWireRow(row: WireRow, ctx: MapContext): MapOutcome {
  const policyReason = wirePolicyExclusionReason(row);
  if (policyReason) return policyDropped(policyReason);
  const wire = normalizeWire(row.wire);
  const evidenceUrl = row.source_url;
  if (!evidenceUrl) return NO_OUTCOME;

  const confidence = normalizeConfidence(row.quality_score);
  const deadline = isoDateOnly(row.deadline_iso) || isoDateOnly(row.deadline);
  const amount = row.amount ? row.amount.trim() || null : null;
  const programNameCandidate = (row.name || '').trim() || null;
  const summaryFallback = `${programNameCandidate || row.name || 'Wire signal'}: dispatch from the wire, no further detail on file.`;
  const summary = safeSummary(row.enriched_summary || row.description, summaryFallback);

  // Resolution only has real signal when org_id is set (org_profiles.name/
  // website/aliases) or the entry's own source_url happens to sit on a
  // known org's domain. Without org_id there is no plausible org NAME to
  // fall back on (the entry's `name` is the opportunity title, not an org
  // name) — such rows can still resolve by domain, but can never become a
  // new_org candidate; that's an honest limitation of the columns available.
  const domainCandidates = [row.org_website, evidenceUrl];
  const nameCandidates = row.org_id != null ? [row.org_name, ...(row.org_aliases || [])] : [];
  const orgResolution = resolveOrg(ctx.index, domainCandidates, nameCandidates);
  if (orgResolution.ambiguous) return policyDropped(`ambiguous org identity (${orgResolution.tier} collision)`);

  return decide({
    org: orgResolution.org,
    orgNameCandidate: row.org_id != null ? row.org_name : null,
    orgWebsiteGuess: row.org_website || null,
    programApplyUrl: null,
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

export function mapDiscussItem(item: DiscussItem, ctx: MapContext): MapOutcome {
  const policyReason = discussCandidateExclusionReason(item);
  if (policyReason) return policyDropped(policyReason);
  const wire = normalizeWire(item.wire);
  const evidenceUrl = item.url;
  if (!evidenceUrl) return NO_OUTCOME;

  const title = (item.title || item.name || '').trim();
  const programNameCandidate = (item.program || title || '').trim() || null;
  const orgNameCandidate = (item.protocol || '').trim() || null;
  const confidence = normalizeConfidence(item.confidence);
  const deadline = isoDateOnly(item.deadline);
  const amount = formatDiscussAmount(item);
  const summaryFallback = `${title || orgNameCandidate || 'A funder'}: funding signal from discuss.watch, no further detail on file.`;
  const summary = safeSummary(item.excerpt || title, summaryFallback);

  // applyUrl (when present) is the org's own "apply here" link, a much
  // better domain signal than the forum thread URL — tried first.
  const orgResolution = resolveOrg(ctx.index, [item.applyUrl, item.url], [orgNameCandidate]);
  if (orgResolution.ambiguous) return policyDropped(`ambiguous org identity (${orgResolution.tier} collision)`);

  return decide({
    org: orgResolution.org,
    orgNameCandidate,
    orgWebsiteGuess: null,
    programApplyUrl: item.applyUrl || null,
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

function normalizeBoundary(value: unknown): DiscussBoundary | null {
  if (!isRecord(value)) return null;
  const since = asIsoTimestamp(value.since);
  if (!since || !Number.isSafeInteger(value.last_id) || (value.last_id as number) < 0) return null;
  return { since, last_id: value.last_id as number };
}

/** Reads both the original {since,last_id} state and the resumable-window
 *  extension defensively. An invalid pending cursor is ignored so it cannot
 *  wedge ingestion forever. */
export function normalizeDiscussWatermark(value: unknown): DiscussWatermark {
  if (!isRecord(value)) return {};
  const completed = normalizeBoundary(value);
  const normalized: DiscussWatermark = {};
  if (completed) {
    normalized.since = completed.since;
    normalized.last_id = completed.last_id;
  }

  const pending = value.pending;
  if (
    isRecord(pending) &&
    (pending.mode === 'incremental' || pending.mode === 'backfill') &&
    Number.isSafeInteger(pending.next_cursor) &&
    (pending.next_cursor as number) >= 0 &&
    (pending.since === null || asIsoTimestamp(pending.since) !== null)
  ) {
    normalized.pending = {
      mode: pending.mode,
      since: pending.since === null ? null : asIsoTimestamp(pending.since),
      next_cursor: pending.next_cursor as number,
      max_seen: normalizeBoundary(pending.max_seen),
    };
  }
  return normalized;
}

export function openDiscussWindow(value: unknown, requestedBackfill: boolean): DiscussWindow {
  const state = normalizeDiscussWatermark(value);
  if (state.pending) {
    return {
      mode: state.pending.mode,
      since: state.pending.since,
      cursor: state.pending.next_cursor,
      maxSeen: state.pending.max_seen,
    };
  }
  const completed = state.since != null && state.last_id != null ? { since: state.since, last_id: state.last_id } : null;
  return {
    mode: requestedBackfill ? 'backfill' : 'incremental',
    since: requestedBackfill ? null : state.since || null,
    cursor: null,
    maxSeen: completed,
  };
}

/** Returns the durable state after a clean page batch. A capped batch keeps
 *  the completed boundary in place and stores its cursor/window. Exhaustion
 *  atomically promotes the accumulated newest boundary and clears pending. */
export function nextDiscussWatermark(value: unknown, window: DiscussWindow, result: DiscussFetchResult): DiscussWatermark | null {
  if (result.error) return null;
  const state = normalizeDiscussWatermark(value);
  const maxSeen = laterDiscussBoundary(window.maxSeen, result.maxSeen);

  if (!result.exhausted) {
    if (result.nextCursor == null) return null;
    const pending: DiscussPendingWindow = {
      mode: window.mode,
      since: window.since,
      next_cursor: result.nextCursor,
      max_seen: maxSeen,
    };
    return {
      ...(state.since != null && state.last_id != null ? { since: state.since, last_id: state.last_id } : {}),
      pending,
    };
  }

  if (maxSeen) return { since: maxSeen.since, last_id: maxSeen.last_id };
  if (state.since != null && state.last_id != null) return { since: state.since, last_id: state.last_id };
  return {};
}

function discussItemAfterBoundary(item: DiscussItem, boundary: DiscussBoundary | null): boolean {
  if (!boundary) return true;
  const itemBoundary = rawDiscussBoundary(item);
  if (!itemBoundary) return true;
  return itemBoundary.since > boundary.since || (itemBoundary.since === boundary.since && itemBoundary.last_id > boundary.last_id);
}

// ============================================================
// orchestration
// ============================================================

export interface IngestOptions {
  backfill?: boolean;
  validationLimit?: number;
}

export interface IngestResult {
  wire_handoff?: WireHandoffReport | null;
  source_counts: {
    wire: { fetched: number; error: string | null; policy_filtered: number; policy_reasons: Record<string, number> };
    discuss: {
      fetched: number;
      error: string | null;
      incomplete: boolean;
      quarantined: number;
      policy_filtered: number;
      policy_reasons: Record<string, number>;
    };
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
  const ctx: MapContext = { index: buildIngestOrgIndex(orgs), programs };

  const candidates: RawMinerProposal[] = [];
  let dropped = 0;
  const wirePolicyReasons: Record<string, number> = {};

  // ---- wire ----
  const wireWatermarkRaw = await getIngestState('wire_scan_entries');
  const wireWatermark = (wireWatermarkRaw && typeof wireWatermarkRaw === 'object' ? (wireWatermarkRaw as WireWatermark) : null);
  const { rows: wireRows, error: wireError } = await fetchWireEntries({ backfill, watermark: backfill ? null : wireWatermark });
  if (wireError) errors.push(`wire: ${wireError}`);
  for (const row of wireRows) {
    const outcome = mapWireRow(row, ctx);
    if (outcome.candidate) candidates.push(outcome.candidate);
    else if (outcome.dropped) {
      dropped++;
      if (outcome.dropReason) wirePolicyReasons[outcome.dropReason] = (wirePolicyReasons[outcome.dropReason] || 0) + 1;
    }
  }
  const wireWatermarkCandidate: WireWatermark | null =
    !wireError && wireRows.length > 0
      ? { last_created_at: wireRows[wireRows.length - 1].created_at, last_id: wireRows[wireRows.length - 1].id }
      : null;

  // ---- discuss.watch ----
  const discussWatermarkRaw = await getIngestState('discuss_grants');
  const discussState = normalizeDiscussWatermark(discussWatermarkRaw);
  const discussWindow = openDiscussWindow(discussState, backfill);
  const discussFetch = await fetchDiscussItems({
    backfill: discussWindow.mode === 'backfill',
    since: discussWindow.since,
    cursor: discussWindow.cursor,
  });
  const discussError = discussFetch.error;
  if (discussError) errors.push(`discuss: ${discussError}`);
  if (!discussError && !discussFetch.exhausted) {
    errors.push(`discuss: page cap reached; cursor ${discussFetch.nextCursor ?? 'unknown'} will resume the current window`);
  }
  if (discussFetch.quarantinedCount > 0) {
    const sample = discussFetch.quarantined
      .slice(0, 3)
      .map((item) => `${item.id ?? 'unknown'}: ${item.reason}`)
      .join('; ');
    errors.push(`discuss: quarantined ${discussFetch.quarantinedCount} malformed item(s)${sample ? ` (${sample})` : ''}`);
    dropped += discussFetch.quarantinedCount;
  }
  dropped += discussFetch.policyFilteredCount;

  // The feed's `since` is inclusive. Compare the timestamp/id tuple only at
  // the completed boundary; a global id-only filter can discard a later item
  // whose source assigned a lower id.
  const completedDiscussBoundary =
    discussState.since != null && discussState.last_id != null ? { since: discussState.since, last_id: discussState.last_id } : null;
  const discussItems =
    discussWindow.mode === 'incremental'
      ? discussFetch.items.filter((item) => discussItemAfterBoundary(item, completedDiscussBoundary))
      : discussFetch.items;
  for (const item of discussItems) {
    const outcome = mapDiscussItem(item, ctx);
    if (outcome.candidate) candidates.push(outcome.candidate);
    else if (outcome.dropped) dropped++;
  }
  const discussWatermarkCandidate = nextDiscussWatermark(discussState, discussWindow, discussFetch);

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
    const discussExcludedCount = discussFetch.quarantinedCount + discussFetch.policyFilteredCount;
    let quarantineStored = discussExcludedCount === 0;
    if (discussExcludedCount > 0) {
      try {
        await setIngestState('discuss_grants_quarantine', {
          at: new Date().toISOString(),
          count: discussExcludedCount,
          malformed_count: discussFetch.quarantinedCount,
          policy_filtered_count: discussFetch.policyFilteredCount,
          policy_reasons: discussFetch.policyReasons,
          truncated: discussExcludedCount > discussFetch.quarantined.length + discussFetch.policyFiltered.length,
          items: [
            ...discussFetch.quarantined.map((item) => ({ ...item, category: 'malformed' })),
            ...discussFetch.policyFiltered.map((item) => ({ ...item, category: 'policy' })),
          ],
        });
        quarantineStored = true;
      } catch (e) {
        errors.push(`discuss quarantine write failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
    if (discussWatermarkCandidate && quarantineStored) {
      try {
        await setIngestState('discuss_grants', discussWatermarkCandidate);
        watermarks.discuss_grants = discussWatermarkCandidate;
      } catch (e) {
        errors.push(`discuss watermark write failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
  }

  let wireHandoff: WireHandoffReport | null = null;
  try { wireHandoff = await runWireHandoff(); }
  catch (e) { errors.push(`wire handoff: ${e instanceof Error ? e.message : 'failed'}`); }

  // ---- machine validation (same pipeline The Desk's "Run validation" button uses) ----
  let validation = { passed: 0, failed: 0 };
  try {
    const result = await runValidation({ limit: opts.validationLimit });
    validation = { passed: result.passed, failed: result.failed };
  } catch (e) {
    errors.push(`validation run failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  }

  return {
    wire_handoff: wireHandoff,
    source_counts: {
      wire: {
        fetched: wireRows.length,
        error: wireError,
        policy_filtered: Object.values(wirePolicyReasons).reduce((sum, count) => sum + count, 0),
        policy_reasons: wirePolicyReasons,
      },
      discuss: {
        fetched: discussItems.length,
        error: discussError,
        incomplete: !discussError && !discussFetch.exhausted,
        quarantined: discussFetch.quarantinedCount,
        policy_filtered: discussFetch.policyFilteredCount,
        policy_reasons: discussFetch.policyReasons,
      },
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

interface DailyIngestClaim {
  day: string;
  status: 'claimed' | 'completed' | 'failed';
  claimed_at: string;
  completed_at?: string;
  failed_at?: string;
  error?: string;
}

interface DailyIngestDependencies {
  getState?: typeof getIngestState;
  setState?: typeof setIngestState;
  run?: () => Promise<IngestResult>;
}

const DAILY_CLAIM_LEASE_MS = 2 * 60 * 60 * 1000;

function dailyClaimKey(day: string): string {
  return `daily_ingest_claim:${day}`;
}

function blocksDailyRun(value: unknown, now: Date): boolean {
  if (!isRecord(value)) return false;
  if (value.status === 'completed') return true;
  if (value.status !== 'claimed' || typeof value.claimed_at !== 'string') return false;
  const claimedAt = Date.parse(value.claimed_at);
  return Number.isFinite(claimedAt) && now.getTime() - claimedAt < DAILY_CLAIM_LEASE_MS;
}

/** Must run inside withIngestLock. The advisory lock serializes the read and
 *  write; this durable day-keyed claim keeps a second replica from starting a
 *  sequential run as soon as the first replica releases that lock. */
export async function runDailyIngestOnce(now: Date = new Date(), deps: DailyIngestDependencies = {}): Promise<{
  executed: boolean;
  day: string;
  result?: IngestResult;
}> {
  const getState = deps.getState ?? getIngestState;
  const setState = deps.setState ?? setIngestState;
  const run = deps.run ?? (() => runIngest({}));
  const day = productDateISO(now);
  const key = dailyClaimKey(day);
  if (blocksDailyRun(await getState(key), now)) return { executed: false, day };

  const claimedAt = now.toISOString();
  const claim: DailyIngestClaim = { day, status: 'claimed', claimed_at: claimedAt };
  await setState(key, claim);
  try {
    const result = await run();
    await setState(key, { ...claim, status: 'completed', completed_at: new Date().toISOString() } satisfies DailyIngestClaim);
    return { executed: true, day, result };
  } catch (e) {
    try {
      await setState(key, {
        ...claim,
        status: 'failed',
        failed_at: new Date().toISOString(),
        error: e instanceof Error ? e.message : 'daily ingest failed',
      } satisfies DailyIngestClaim);
    } catch {
      // Preserve the original run error. A failed claim write must not hide it.
    }
    throw e;
  }
}

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
      const { ran, result } = await withIngestLock(() => runDailyIngestOnce());
      // Another replica already completed or claimed this product day. Keep
      // its full last_run record instead of replacing it with a skip record.
      if (ran && result && !result.executed) return;
      const at = new Date().toISOString();
      await setIngestState(
        'last_run',
        ran && result?.executed
          ? { at, skipped_lock: false, ...result.result }
          : { at, skipped_lock: true }
      );
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
