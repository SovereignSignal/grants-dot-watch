import { decideProposal } from '@/lib/desk-decide';
import { checkAuth, unauthorized } from '../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DecideBody {
  id?: string;
  decision?: 'approved' | 'rejected';
  note?: string;
}

export async function POST(req: Request) {
  const auth = await checkAuth(req);
  if (!auth.ok) return unauthorized();

  let body: DecideBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }

  const { id, decision, note } = body;
  if (!id || (decision !== 'approved' && decision !== 'rejected')) {
    return Response.json({ error: 'id and decision (approved|rejected) are required' }, { status: 400 });
  }

  const result = await decideProposal({ id, decision, note });
  return Response.json(result.body, { status: result.status });
}
