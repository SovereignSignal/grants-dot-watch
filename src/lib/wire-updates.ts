import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { httpUrl } from './evidence-fields';
import { loadRegistry } from './registry';
import { loadWireMappings } from './wire-mappings';
import { authorizeReader, readerJson } from './reader-auth';

// These are reviewed observations, not attestations that a call is open, a
// source is current, or an item has been delivered to any publishing channel.
export const UPDATE_SELECT = `SELECT id, name, description, source_url, wire, amount, deadline,
  to_char(deadline_parsed, 'YYYY-MM-DD') AS deadline_iso, classification,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS discovered_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS changed_at
  FROM scan_entries WHERE status = 'approved' AND distributable IS TRUE
    AND wire IN ('crypto', 'ai', 'oss') AND duplicate_of_id IS NULL
    AND COALESCE(metadata->>'operator_route', '') NOT IN ('relationship_signal', 'applicant_observation')
    AND NULLIF(btrim(name), '') IS NOT NULL AND NULLIF(btrim(description), '') IS NOT NULL
    AND NULLIF(btrim(source_url), '') IS NOT NULL`;

export interface UpdateRow {
  id: number; name: string; description: string; source_url: string; wire: string;
  amount: string | null; deadline: string | null; deadline_iso: string | null;
  classification: string | null; discovered_at: string; changed_at: string;
}
export interface UpdatePage { after: number; through?: number; limit: number }
function integer(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('Invalid integer');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > 2147483647) throw new Error('Invalid integer');
  return n;
}
export function parseUpdatePage(params: URLSearchParams): UpdatePage {
  for (const key of params.keys()) {
    if (!['after_id', 'through_id', 'limit'].includes(key) || params.getAll(key).length !== 1) throw new Error('Invalid parameter');
  }
  const after = integer(params.get('after_id'), 0);
  const through = params.has('through_id') ? integer(params.get('through_id'), 0) : undefined;
  const limit = integer(params.get('limit'), 100);
  if (limit < 1 || limit > 100 || (after > 0 && through === undefined) || (through !== undefined && after > through)) throw new Error('Invalid page');
  return { after, through, limit };
}

export function publicUpdate(row: UpdateRow, mappings: Map<number, string>, livePrograms: Set<string>) {
  const source = httpUrl(row.source_url);
  if (!source) return null;
  const mapped = mappings.get(row.id);
  const program = mapped && livePrograms.has(mapped) ? mapped : null;
  // Explicit picks at both SQL and serialization boundaries. Never spread a
  // database row: it may acquire internal fields in a later migration.
  const content = {
    id: `wire:${row.id}`, title: row.name, summary: row.description, wire: row.wire,
    source_url: source, amount: row.amount, deadline: row.deadline, deadline_iso: row.deadline_iso,
    classification: row.classification, review_status: 'approved' as const,
    program_id: program, program_url: program ? `https://grants.watch/programs/${program}` : null,
    source_verified_at: null,
  };
  return { ...content, revision: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    discovered_at: row.discovered_at, changed_at: row.changed_at };
}

let wirePool: Pool | undefined;
function getWirePool() {
  if (!process.env.WIRE_DATABASE_URL) throw new Error('Wire source not configured');
  if (!wirePool) {
    wirePool = new Pool({ connectionString: process.env.WIRE_DATABASE_URL, max: 2,
      connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000,
      options: '-c default_transaction_read_only=on -c statement_timeout=15000',
      application_name: 'grants_watch_reader_api' });
    wirePool.on('error', () => console.error('Wire reader connection unavailable'));
  }
  return wirePool;
}

export async function readUpdatePage(page: UpdatePage, pool = getWirePool()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const through: number = page.through ?? (await client.query('SELECT COALESCE(MAX(id), 0)::int AS id FROM scan_entries')).rows[0].id;
    const { rows } = await client.query<UpdateRow>(`${UPDATE_SELECT}
      AND id > $1 AND id <= $2 ORDER BY id LIMIT $3`, [page.after, through, page.limit + 1]);
    await client.query('ROLLBACK');
    return { rows: rows.slice(0, page.limit), through,
      next: rows.length > page.limit ? rows[page.limit - 1].id : null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

const dependencies = {
  authorize: authorizeReader,
  read: readUpdatePage,
  mappings: loadWireMappings,
  programs: () => new Set(loadRegistry().programs.map(p => p.id)),
  log: (record: Record<string, unknown>) => console.info(JSON.stringify(record)),
};
export async function serveUpdates(request: Request, id?: string, deps = dependencies): Promise<Response> {
  const auth = deps.authorize(request);
  if ('response' in auth) return auth.response;
  const started = Date.now();
  let status = 200, count = 0;
  try {
    let page: UpdatePage;
    try {
      if (id !== undefined) {
        const number = integer(id, 0);
        if (number < 1 || new URL(request.url).search) throw new Error('Invalid record');
        page = { after: number - 1, through: number, limit: 1 };
      } else page = parseUpdatePage(new URL(request.url).searchParams);
    } catch {
      status = 400; return readerJson({ error: 'invalid_request' }, status);
    }
    const [result, mappings] = await Promise.all([deps.read(page), deps.mappings()]);
    const programs = deps.programs();
    const data = result.rows.map(row => publicUpdate(row, mappings, programs)).filter(row => row !== null);
    count = data.length;
    if (id !== undefined && !data.length) {
      status = 404; return readerJson({ error: 'not_available', message: 'No currently eligible update with this ID.' }, status);
    }
    return readerJson({ data: id === undefined ? data : data[0], meta: {
      version: 1, fetched_at: new Date().toISOString(), through_id: result.through,
      next_after_id: result.next, limit: page.limit,
      mode: 'full_scan', verification: 'Recheck the primary source before publishing. Approval does not establish current availability or delivery.',
    } });
  } catch {
    status = 503;
    return readerJson({ error: 'source_unavailable', message: 'Keep the previous checkpoint; retry later.' }, status);
  } finally {
    // Usage logs contain no credential, query string, source prose, or identity data.
    deps.log({ event: 'reader_api', client: auth.client, resource: 'wire_updates', status, count, duration_ms: Date.now() - started });
  }
}
