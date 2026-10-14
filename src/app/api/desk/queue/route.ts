import { proposalDestinations } from '@/lib/committer';
import { listProposals, listVerdicts, queueCounts } from '@/lib/desk-store';
import { getSignalEvidence } from '@/lib/signal-lookup';
import type { Proposal } from '@/lib/types';
import { checkAuth, unauthorized } from '../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** WHERE, at a glance: the paths approve would write, from the same builders
 *  applyProposal uses, minus the funding dataset validation that approve
 *  still runs (see proposalDestinations). Wrapped per-proposal: one proposal
 *  that can't resolve a target (e.g. an ambiguous program match) must never
 *  take the whole queue down. */
function destinationFor(p: Proposal): { paths: string[] | null; error: string | null } {
  try {
    return { paths: proposalDestinations(p), error: null };
  } catch (e) {
    return { paths: null, error: e instanceof Error ? e.message : 'destination could not be resolved' };
  }
}

/** Enriches a proposal with the two things a card needs to show at a glance
 *  without a follow-up fetch: WHERE it writes, and the wire signal it came
 *  from (VALIDATE). WHAT (the full diff) stays behind /api/desk/preview,
 *  fetched per card since it re-reads the target file. */
function enrich(p: Proposal) {
  const { paths, error } = destinationFor(p);
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
