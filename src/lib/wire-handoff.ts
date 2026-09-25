// Wire Room observations enter the existing research/Desk ledger. Publication
// still requires an accepted registry proposal; a source status is not a verdict.
import { Pool } from 'pg';
import { contentHash, ingestResearch, type Finding, type ResearchReport } from './research-intake';
import { getIngestState, setIngestState } from './desk-store';
import type { Wire } from './types';
import { httpUrl } from './evidence-fields';
import { loadWireMappings } from './wire-mappings';
export { acceptedWireMappings } from './wire-mappings';

export const WIRE_HANDOFF_CURSOR = 'wire_handoff_v1';
export interface WireChangeCursor { changed_at: string; id: number }
export interface WireObservation {
  id: number; program_id: number | null; duplicate_of_id: number | null; name: string; description: string | null;
  enriched_summary: string | null; source_url: string; amount: string | null;
  deadline: string | null; deadline_iso: string | null; status: string; wire: string;
  classification: string | null; tags: string[] | null; org_id: number | null;
  org_name: string | null; org_website: string | null; org_aliases: string[] | null;
  changed_at: string;
}
export const WIRE_CHANGE_SELECT = `SELECT se.id, se.program_id, se.duplicate_of_id, se.name, se.description,
  se.enriched_summary, se.source_url, se.amount, se.deadline,
  to_char(se.deadline_parsed, 'YYYY-MM-DD') AS deadline_iso,
  se.status, se.wire, se.classification, se.tags, se.org_id,
  op.name AS org_name, op.website AS org_website, op.aliases AS org_aliases,
  to_char(GREATEST(se.created_at, se.updated_at, op.created_at, op.updated_at)
    AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS changed_at
  FROM scan_entries se LEFT JOIN org_profiles op ON op.id = se.org_id`;

export function parseWireCursor(value: unknown): WireChangeCursor {
  const c = value as WireChangeCursor | null;
  if (!c || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(c.changed_at)
    || !Number.isFinite(Date.parse(c.changed_at)) || !Number.isSafeInteger(c.id) || c.id < 0) {
    throw new Error('Wire handoff needs an explicitly reviewed timestamp/id checkpoint');
  }
  return { changed_at: c.changed_at, id: c.id };
}

export async function fetchWireChanges(pool: Pick<Pool, 'query'>, cursor: WireChangeCursor, limit = 200): Promise<WireObservation[]> {
  const c = parseWireCursor(cursor);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Wire handoff batch must contain 1 to 200 records');
  // No status filter: withdrawals must reach review. Preserve PostgreSQL's
  // microseconds and use the ID to traverse rows sharing the same timestamp.
  const result = await pool.query(`${WIRE_CHANGE_SELECT}
    WHERE (GREATEST(se.created_at, se.updated_at, op.created_at, op.updated_at), se.id) > ($1::timestamptz, $2::integer)
    ORDER BY GREATEST(se.created_at, se.updated_at, op.created_at, op.updated_at), se.id LIMIT $3`,
  [c.changed_at, c.id, limit]);
  return result.rows as WireObservation[];
}

function clean(value: string | null): string | null {
  // Remove only known observation boilerplate, not dates inside source prose.
  return value?.replace(/^\s*(?:Date found|Scanned on|Scan date):[^\n]*\n?/gim, '').trim() || null;
}

export function wireFinding(row: WireObservation, mappings: Map<number, string>): Finding {
  const program = mappings.get(row.id);
  const source = {
    program_id: row.program_id, duplicate_of_id: row.duplicate_of_id, status: row.status, classification: row.classification,
    org_id: row.org_id, org_name: clean(row.org_name), org_website: httpUrl(row.org_website),
    org_aliases: [...new Set((row.org_aliases || []).map(a => a.trim()).filter(Boolean))].sort(),
    amount: clean(row.amount), deadline: clean(row.deadline), deadline_iso: row.deadline_iso,
    tags: [...new Set(row.tags || [])].sort(), description: clean(row.description), enriched_summary: clean(row.enriched_summary),
  };
  // Source terms stay as evidence. No invented deadline, official-source
  // attestation, new public program, or automatic deletion on withdrawal.
  return {
    id: `wire:${row.id}`, title: row.name.trim(), source_url: httpUrl(row.source_url),
    summary: clean(row.enriched_summary) || clean(row.description) || row.name.trim(),
    observed_at: row.changed_at, source_kind: 'secondary', ...(program ? { program_id: program } : {}),
    wire_record: source,
  };
}

export interface WireHandoffReport {
  saved: boolean; cursor_before: WireChangeCursor | null; cursor_after: WireChangeCursor | null;
  records: number; reports: ResearchReport[];
}

/** Per-wire packets reuse the existing durable evidence store. If a later
 * packet fails, its predecessors are replay-safe and the cursor stays put. */
export async function handoffWireRows(rows: WireObservation[], opts: {
  save?: boolean; cursor?: WireChangeCursor; advance?: boolean;
}, deps = { ingest: ingestResearch, mappings: loadWireMappings, setState: setIngestState }): Promise<WireHandoffReport> {
  if (rows.length > 200) throw new Error('Wire handoff accepts at most 200 records');
  if (opts.advance && (!opts.save || !opts.cursor)) throw new Error('Advancing requires saved outcomes and an explicit prior checkpoint');
  const mappings = await deps.mappings();
  const groups = new Map<Wire, WireObservation[]>();
  // Validate the whole batch before persisting anything, including source
  // timestamps. Invalid rows must not be skipped behind an advancing cursor.
  for (const row of rows) {
    parseWireCursor({ changed_at: row.changed_at, id: row.id });
    if (!['crypto', 'ai', 'oss'].includes(row.wire)) throw new Error(`Unsupported Wire channel on entry ${row.id}`);
    if (opts.cursor && (row.changed_at < opts.cursor.changed_at || (row.changed_at === opts.cursor.changed_at && row.id <= opts.cursor.id))) throw new Error('Wire batch is behind the checkpoint');
    const group = groups.get(row.wire as Wire) || [];
    group.push(row); groups.set(row.wire as Wire, group);
  }
  const reports: ResearchReport[] = [];
  for (const [wire, group] of groups) {
    const findings = group.map(row => wireFinding(row, mappings));
    const completed_at = group.map(r => r.changed_at).sort().at(-1)!;
    // Deterministic run identity makes a partially persisted batch retryable.
    const run_id = `wire-${contentHash({ wire, findings }).slice(0, 40)}`;
    reports.push(await deps.ingest({ version: 1, run_id, wire, producer: 'wire-room', completed_at,
      coverage: [{ provider: 'wire-room', status: 'complete', results: findings.length }], findings }, opts.save === true));
  }
  const last = [...rows].sort((a, b) => a.changed_at.localeCompare(b.changed_at) || a.id - b.id).at(-1);
  const after = last ? { changed_at: last.changed_at, id: last.id } : opts.cursor || null;
  if (opts.advance && after) await deps.setState(WIRE_HANDOFF_CURSOR, after);
  return { saved: opts.save === true, records: rows.length, cursor_before: opts.cursor || null, cursor_after: opts.advance ? after : opts.cursor || null, reports };
}

/** The existing daily job calls this only after an operator has reviewed
 * and installed the initial checkpoint. Historical replay is a separate,
 * bounded operation; the old creation cursor cannot stand in for it. */
export async function runWireHandoff(): Promise<WireHandoffReport | null> {
  const checkpoint = await getIngestState(WIRE_HANDOFF_CURSOR);
  if (checkpoint === null) return null;
  const cursor = parseWireCursor(checkpoint);
  if (!process.env.WIRE_DATABASE_URL) throw new Error('WIRE_DATABASE_URL not set');
  const pool = new Pool({ connectionString: process.env.WIRE_DATABASE_URL,
    options: '-c default_transaction_read_only=on -c statement_timeout=30000', connectionTimeoutMillis: 10_000 });
  try {
    const rows = await fetchWireChanges(pool, cursor);
    return await handoffWireRows(rows, { save: true, advance: true, cursor });
  } finally { await pool.end(); }
}
