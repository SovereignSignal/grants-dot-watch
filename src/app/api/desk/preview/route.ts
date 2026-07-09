import { buildProposalChanges } from '@/lib/committer';
import { getProposal } from '@/lib/desk-store';
import { checkAuth, unauthorized } from '../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await checkAuth(req);
  if (!auth.ok) return unauthorized();

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const proposal = await getProposal(id);
  if (!proposal) return Response.json({ error: 'not found' }, { status: 404 });

  try {
    const { changes, notes } = buildProposalChanges(proposal);
    return Response.json({ changes, notes });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'preview failed' }, { status: 500 });
  }
}
