// The Desk's Approve / Reject button, extracted so the curator API can call
// the same function. File writes and git (or the GRANTS_WATCH_NO_GIT ledger)
// stay in applyProposalDurably. This module only sequences claim, apply, and
// the verdict log.
import { applyProposalDurably, commitMessageFor, registryMayHaveChanged } from './committer';
import { claimProposal, getProposal, recordVerdict, releaseProposalClaim } from './desk-store';
import type { Proposal, Verdict } from './types';

export interface DecideInput {
  id: string;
  decision: 'approved' | 'rejected';
  note?: string;
  by?: 'owner' | 'machine' | 'curator';
  curator_id?: string;
  curator_name?: string;
  sources?: string[];
}

export interface DecideResult {
  status: number;
  body: {
    ok?: true;
    commit?: string | null;
    proposal?: Proposal;
    verdict?: Verdict;
    error?: string;
    reconciliation_hold?: true;
  };
}

export interface DecideDeps {
  getProposal: typeof getProposal;
  claimProposal: typeof claimProposal;
  releaseProposalClaim: typeof releaseProposalClaim;
  recordVerdict: typeof recordVerdict;
  applyProposalDurably: typeof applyProposalDurably;
  registryMayHaveChanged: typeof registryMayHaveChanged;
}

export const defaultDecideDeps: DecideDeps = {
  getProposal,
  claimProposal,
  releaseProposalClaim,
  recordVerdict,
  applyProposalDurably,
  registryMayHaveChanged,
};

function applyMessage(proposal: Proposal, input: DecideInput): string {
  const base = commitMessageFor(proposal);
  if (input.by !== 'curator') return base;
  const who = `${input.curator_name || 'curator'} (${input.curator_id || 'unknown'})`;
  const lines = [base, '', `Curator: ${who}`];
  if (input.note) lines.push(`Reason: ${input.note.replace(/\s+/g, ' ').trim()}`);
  if (input.sources?.length) lines.push(`Sources: ${input.sources.join(' ')}`);
  return lines.join('\n');
}

/** Same sequence as POST /api/desk/decide. `by` stays unset for the Desk
 *  button, which the log reads as the owner. */
export async function decideProposal(input: DecideInput, deps: DecideDeps = defaultDecideDeps): Promise<DecideResult> {
  const { id, decision, note } = input;
  if (!id || (decision !== 'approved' && decision !== 'rejected')) {
    return { status: 400, body: { error: 'id and decision (approved|rejected) are required' } };
  }

  let proposal = await deps.getProposal(id);
  if (!proposal) return { status: 404, body: { error: 'not found' } };
  if (proposal.state !== 'pending') return { status: 409, body: { error: 'already decided' } };

  let commit: string | null = null;
  let mergedNote = note;
  let ledgerRequired = false;

  if (decision === 'approved') {
    const claimed = await deps.claimProposal(id);
    if (!claimed) return { status: 409, body: { error: 'already claimed or decided' } };
    proposal = claimed;
    try {
      const { notes, changes, commit: appliedCommit } = await deps.applyProposalDurably(proposal, applyMessage(proposal, input));
      commit = appliedCommit;
      ledgerRequired = Boolean(process.env.DATABASE_URL) && changes.length > 0 && appliedCommit === null;
      if (notes.length) mergedNote = [note, ...notes].filter(Boolean).join(' | ');
    } catch (e) {
      const held = deps.registryMayHaveChanged(e);
      if (!held) await deps.releaseProposalClaim(id);
      return {
        status: 500,
        body: {
          error: e instanceof Error ? e.message : 'apply failed',
          ...(held ? { reconciliation_hold: true as const } : {}),
        },
      };
    }
  }

  const { proposal: updated, verdict } = await deps.recordVerdict(id, decision, {
    note: mergedNote,
    commit,
    from: decision === 'approved' ? 'applying' : 'pending',
    ledgerRequired,
    ...(input.by ? { by: input.by } : {}),
    ...(input.by === 'curator'
      ? { curator_id: input.curator_id, curator_name: input.curator_name, sources: input.sources }
      : {}),
  });
  return { status: 200, body: { ok: true, commit, proposal: updated, verdict } };
}
