import { type AppliedChange, commitChange, writeProposalChanges } from '@/lib/committer';
import { getProposal, recordVerdict } from '@/lib/desk-store';
import { invalidateRegistryCache } from '@/lib/registry';
import type { Proposal } from '@/lib/types';
import { typeCountsSummary } from '@/proposal-lanes';
import { checkAuth, unauthorized } from '../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Keep bulk requests small enough that one slow/failing item never turns into
// a multi-minute request or a commit touching hundreds of files at once.
const MAX_IDS = 60;

interface DecideBulkBody {
  ids?: string[];
  decision?: 'approved' | 'rejected';
  note?: string;
}

interface FailedItem {
  id: string;
  error: string;
}

function uniquePaths(changes: AppliedChange[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of changes) {
    if (!seen.has(c.path)) {
      seen.add(c.path);
      out.push(c.path);
    }
  }
  return out;
}

/** "Desk bulk approve: 46 items (34 new orgs, 12 round updates)" — one commit
 *  message for the whole batch, trailers attached per repo convention. */
function bulkCommitMessage(proposals: Proposal[]): string {
  const summary = typeCountsSummary(proposals.map((p) => p.type));
  const header = `Desk bulk approve: ${proposals.length} item${proposals.length === 1 ? '' : 's'}${summary ? ` (${summary})` : ''}`;
  return [
    header,
    '',
    'Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>',
    'Claude-Session: https://claude.ai/code/session_01Vi8zyJH5buofwRqv3fLQdL',
  ].join('\n');
}

export async function POST(req: Request) {
  const auth = await checkAuth(req);
  if (!auth.ok) return unauthorized();

  let body: DecideBulkBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }

  const { ids, decision, note } = body;
  if (!Array.isArray(ids) || ids.length === 0 || (decision !== 'approved' && decision !== 'rejected')) {
    return Response.json(
      { error: 'ids (non-empty array) and decision (approved|rejected) are required' },
      { status: 400 }
    );
  }
  if (ids.length > MAX_IDS) {
    return Response.json({ error: `too many ids: ${ids.length} (max ${MAX_IDS} per request)` }, { status: 400 });
  }

  const failed: FailedItem[] = [];
  const decided: string[] = [];

  if (decision === 'rejected') {
    // Verdicts only — no file writes, no commit.
    for (const id of ids) {
      const proposal = await getProposal(id);
      if (!proposal) {
        failed.push({ id, error: 'not found' });
        continue;
      }
      if (proposal.state !== 'pending') {
        failed.push({ id, error: 'already decided' });
        continue;
      }
      try {
        await recordVerdict(id, 'rejected', { note });
        decided.push(id);
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : 'reject failed' });
      }
    }
    return Response.json({ ok: true, decided, failed, commit: null });
  }

  // decision === 'approved': apply every proposal's file changes (no per-item
  // commit), then one commit for the whole batch. A single proposal's apply
  // failure is collected and skipped — it must never abort the rest.
  const applied: { id: string; proposal: Proposal; notes: string[] }[] = [];
  const allChanges: AppliedChange[] = [];

  for (const id of ids) {
    const proposal = await getProposal(id);
    if (!proposal) {
      failed.push({ id, error: 'not found' });
      continue;
    }
    if (proposal.state !== 'pending') {
      failed.push({ id, error: 'already decided' });
      continue;
    }
    try {
      const { changes, notes } = writeProposalChanges(proposal);
      allChanges.push(...changes);
      applied.push({ id, proposal, notes });
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : 'apply failed' });
    }
  }

  if (allChanges.length > 0) invalidateRegistryCache();

  const changedPaths = uniquePaths(allChanges);
  const commit =
    changedPaths.length > 0
      ? await commitChange(
          changedPaths,
          bulkCommitMessage(applied.map((a) => a.proposal)),
          applied.map((a) => a.id).join(',')
        )
      : null;

  for (const { id, notes } of applied) {
    const mergedNote = notes.length ? [note, ...notes].filter(Boolean).join(' | ') : note;
    try {
      await recordVerdict(id, 'approved', { note: mergedNote, commit });
      decided.push(id);
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : 'verdict record failed' });
    }
  }

  return Response.json({ ok: true, decided, failed, commit });
}
