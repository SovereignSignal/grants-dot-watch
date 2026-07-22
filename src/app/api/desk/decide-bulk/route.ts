import {
  type AppliedChange,
  assertCleanGitPaths,
  commitChange,
  commitMessageFor,
  prepareProposalChanges,
  recordPreparedChangeIntent,
  registryMayHaveChanged,
  writePreparedChanges,
} from '@/lib/committer';
import { claimProposal, getProposal, recordVerdict, releaseProposalClaim } from '@/lib/desk-store';
import { validateStagedChanges } from '@/lib/proposal-validator';
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
  if (process.env.GRANTS_WATCH_NO_GIT === '1' && !process.env.DATABASE_URL) {
    return Response.json(
      { error: 'GRANTS_WATCH_NO_GIT=1 requires DATABASE_URL for durable approvals' },
      { status: 503 }
    );
  }
  const applied: { id: string; proposal: Proposal; notes: string[]; changes: AppliedChange[] }[] = [];
  const allChanges: AppliedChange[] = [];
  const dirtySnapshots = new Map<string, string>();
  const claimedPaths = new Set<string>();

  for (const id of ids) {
    const proposal = await claimProposal(id);
    if (!proposal) {
      const existing = await getProposal(id);
      failed.push({ id, error: existing ? 'already claimed or decided' : 'not found' });
      continue;
    }
    try {
      const prepared = prepareProposalChanges(proposal);
      assertCleanGitPaths(prepared.changes, dirtySnapshots);
      const paths = [...new Set(prepared.changes.map((change) => change.path))];
      const overlap = paths.find((path) => claimedPaths.has(path));
      if (overlap) throw new Error(`${overlap} is already targeted by another proposal in this batch`);
      const stagedError = validateStagedChanges(prepared.changes);
      if (stagedError) throw new Error(`staged registry validation failed: ${stagedError}`);
      // Railway has an ephemeral filesystem. Persist each proposal's complete
      // compare-and-set snapshot before its local write so a crash cannot erase
      // the only durable copy of an approved change.
      if (process.env.GRANTS_WATCH_NO_GIT === '1') {
        await recordPreparedChangeIntent(prepared, commitMessageFor(proposal), proposal.id);
      }
      const { changes, notes } = writePreparedChanges(prepared);
      allChanges.push(...changes);
      for (const change of changes) {
        if (change.content_after !== undefined) dirtySnapshots.set(change.path, change.content_after);
        claimedPaths.add(change.path);
      }
      applied.push({ id, proposal, notes, changes });
    } catch (e) {
      if (!registryMayHaveChanged(e)) await releaseProposalClaim(id);
      failed.push({ id, error: e instanceof Error ? e.message : 'apply failed' });
    }
  }

  if (allChanges.length > 0) invalidateRegistryCache();

  const changedPaths = uniquePaths(allChanges);
  const commit =
    changedPaths.length > 0 && process.env.GRANTS_WATCH_NO_GIT !== '1'
      ? await commitChange(
          changedPaths,
          bulkCommitMessage(applied.map((a) => a.proposal)),
          applied.map((a) => a.id).join(','),
          allChanges,
          { recordFallback: false }
        )
      : null;

  if (changedPaths.length > 0 && process.env.GRANTS_WATCH_NO_GIT !== '1' && commit === null) {
    for (const item of applied) {
      await recordPreparedChangeIntent(
        { changes: item.changes, notes: item.notes },
        commitMessageFor(item.proposal),
        item.id
      );
    }
  }

  for (const { id, notes, changes } of applied) {
    const mergedNote = notes.length ? [note, ...notes].filter(Boolean).join(' | ') : note;
    try {
      await recordVerdict(id, 'approved', {
        note: mergedNote,
        commit,
        from: 'applying',
        ledgerRequired: Boolean(process.env.DATABASE_URL) && changes.length > 0 && commit === null,
      });
      decided.push(id);
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : 'verdict record failed' });
    }
  }

  return Response.json({ ok: true, decided, failed, commit });
}
