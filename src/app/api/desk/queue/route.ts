import { listProposals, listVerdicts, queueCounts } from '@/lib/desk-store';
import type { Proposal } from '@/lib/types';
import { checkAuth, unauthorized } from '../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await checkAuth(req);
  if (!auth.ok) return unauthorized();

  const url = new URL(req.url);
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
    proposals,
    counts,
    verdicts,
    dev: auth.dev === true,
  });
}
