import { applyProposalDurably, registryMayHaveChanged } from '@/lib/committer';
import { claimProposal, getProposal, recordVerdict, releaseProposalClaim } from '@/lib/desk-store';
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

  let proposal = await getProposal(id);
  if (!proposal) return Response.json({ error: 'not found' }, { status: 404 });
  if (proposal.state !== 'pending') return Response.json({ error: 'already decided' }, { status: 409 });

  let commit: string | null = null;
  let mergedNote = note;
  let ledgerRequired = false;

  if (decision === 'approved') {
    const claimed = await claimProposal(id);
    if (!claimed) return Response.json({ error: 'already claimed or decided' }, { status: 409 });
    proposal = claimed;
    try {
      const { notes, changes, commit: appliedCommit } = await applyProposalDurably(proposal);
      commit = appliedCommit;
      ledgerRequired = Boolean(process.env.DATABASE_URL) && changes.length > 0 && appliedCommit === null;
      if (notes.length) mergedNote = [note, ...notes].filter(Boolean).join(' | ');
    } catch (e) {
      const held = registryMayHaveChanged(e);
      if (!held) await releaseProposalClaim(id);
      return Response.json(
        {
          error: e instanceof Error ? e.message : 'apply failed',
          ...(held ? { reconciliation_hold: true } : {}),
        },
        { status: 500 }
      );
    }
  }

  const { proposal: updated, verdict } = await recordVerdict(id, decision, {
    note: mergedNote,
    commit,
    from: decision === 'approved' ? 'applying' : 'pending',
    ledgerRequired,
  });
  return Response.json({ ok: true, commit, proposal: updated, verdict });
}
