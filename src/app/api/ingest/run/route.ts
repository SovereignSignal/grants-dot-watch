import { runIngest } from '@/lib/ingest';
import { checkAuth, unauthorized } from '../../desk/lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IngestRunBody {
  backfill?: boolean;
  limit?: number;
}

/** The daily ingest loop's manual trigger (docs/DESIGN.md "Signal flow") —
 *  same auth as every other /api/desk/* route. `{backfill: true}` ignores
 *  watermarks and pulls wire scan_entries from the last 180 days and the
 *  discuss.watch feed from its beginning; omit it for the normal
 *  since-watermark pull the daily timer (instrumentation.ts) also runs. */
export async function POST(req: Request) {
  const auth = await checkAuth(req);
  if (!auth.ok) return unauthorized();

  let body: IngestRunBody = {};
  try {
    body = await req.json();
  } catch {
    // no body / empty body is fine — defaults to a normal incremental run
  }

  const backfill = body.backfill === true;
  const validationLimit = typeof body.limit === 'number' && body.limit > 0 ? body.limit : undefined;

  try {
    const result = await runIngest({ backfill, validationLimit });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'ingest run failed' }, { status: 500 });
  }
}
