import { applyProposal, commitChange, commitMessageFor } from '@/lib/committer';
import { getProposal, recordVerdict } from '@/lib/desk-store';
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

  const proposal = await getProposal(id);
  if (!proposal) return Response.json({ error: 'not found' }, { status: 404 });
  if (proposal.state !== 'pending') return Response.json({ error: 'already decided' }, { status: 409 });

  let commit: string | null = null;
  let mergedNote = note;

  if (decision === 'approved') {
    try {
      const { changes, notes } = applyProposal(proposal);
      if (changes.length > 0) {
        commit = commitChange(changes.map((c) => c.path), commitMessageFor(proposal));
      }
      if (notes.length) mergedNote = [note, ...notes].filter(Boolean).join(' | ');
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : 'apply failed' }, { status: 500 });
    }
  }

  const { proposal: updated, verdict } = await recordVerdict(id, decision, { note: mergedNote, commit });
  return Response.json({ ok: true, commit, proposal: updated, verdict });
}
