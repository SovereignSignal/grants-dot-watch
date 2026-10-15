import { queueDestination } from '@/lib/committer';
import { listProposals, listVerdicts, queueCounts } from '@/lib/desk-store';
import { getSignalEvidence } from '@/lib/signal-lookup';
import type { Proposal } from '@/lib/types';
import { checkAuth, unauthorized } from '../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Enriches a proposal with the two things a card needs to show at a glance
 *  without a follow-up fetch: WHERE it writes, and the wire signal it came
 *  from (VALIDATE). WHAT (the full diff) stays behind /api/desk/preview,
 *  fetched per card since it re-reads the target file. */
function enrich(p: Proposal) {
  const { paths, error } = queueDestination(p);
  return {
    ...p,
    destination: paths,
    destination_error: error,
    evidence: getSignalEvidence(p.signal_id),
  };
}

export async function GET(req: Request) {
  const auth = await checkAuth(req);
  if (!auth.ok) return unauthorized();

  const url = new URL(req.url);
  // The admin gate only needs to know the caller is authorized: answer with counts, no queue.
  if (url.searchParams.get('counts') === '1') return Response.json({ counts: await queueCounts() });
  const lane = url.searchParams.get('lane');
  const state = url.searchParams.get('state');

  const [proposals, counts, verdicts] = await Promise.all([
    listProposals({
      lane: lane === 'judgment' || lane === 'fact' ? lane : undefined,
      state: (state as Proposal['state'] | null) || undefined,
    }),
    queueCounts(),
    listVerdicts(),
  ]);

  return Response.json({
    proposals: proposals.map(enrich),
    counts,
    verdicts,
    dev: auth.dev === true,
  });
}
