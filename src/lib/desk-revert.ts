// Owner revert of one auto-applied X handle. Writes the audited old value
// back through the same registry apply path, then marks the verdict.
import { readXHandleEdit } from './curator-auto-apply';
import { applyProposalDurably } from './committer';
import { getProposal, listVerdicts, markVerdictReverted } from './desk-store';
import type { Proposal } from './types';

export interface RevertDeps {
  getProposal: typeof getProposal;
  listVerdicts: typeof listVerdicts;
  apply: typeof applyProposalDurably;
  markReverted: typeof markVerdictReverted;
  now: () => string;
}

export const defaultRevertDeps: RevertDeps = {
  getProposal,
  listVerdicts,
  apply: applyProposalDurably,
  markReverted: markVerdictReverted,
  now: () => new Date().toISOString(),
};

export async function revertAutoApply(
  id: string,
  deps: RevertDeps = defaultRevertDeps
): Promise<{ status: number; body: { ok?: true; id?: string; commit?: string | null; old_value?: string | null; error?: string } }> {
  if (!/^p\d+$/.test(id)) return { status: 404, body: { error: 'not_found' } };
  const proposal = await deps.getProposal(id);
  if (!proposal) return { status: 404, body: { error: 'not_found' } };
  const verdict = (await deps.listVerdicts()).find(
    (item) => item.proposal_id === id && item.decision === 'approved' && item.auto_apply
  );
  if (!verdict?.auto_apply) return { status: 404, body: { error: 'not_found' } };
  if (verdict.reverted_at) return { status: 409, body: { error: 'already_reverted' } };
  const edit = readXHandleEdit(proposal.proposed_change);
  if (!edit) return { status: 400, body: { error: 'not_revertable' } };
  const oldValue = verdict.auto_apply.old_value;
  const synthetic: Proposal = {
    id: `${id}-revert`,
    type: 'profile_note',
    org: edit.orgId,
    org_name: proposal.org_name,
    program: null,
    title: `Revert ${proposal.title}`,
    summary: proposal.summary,
    evidence_url: verdict.auto_apply.fetched_url,
    proposed_change: {
      [`orgs/${edit.orgId}.yaml`]: {
        socials: { x: oldValue },
        sources: proposal.submitted_by?.sources || [],
      },
    },
    wire: proposal.wire,
    lane: 'judgment',
    state: 'pending',
    created_at: deps.now(),
  };
  try {
    const applied = await deps.apply(
      synthetic,
      [
        `Revert auto-applied X handle on ${id}`,
        '',
        `Restores ${oldValue ?? 'no handle'} in place of ${verdict.auto_apply.new_value ?? 'no handle'}.`,
      ].join('\n')
    );
    const updated = await deps.markReverted(id, verdict.at, {
      reverted_at: deps.now(),
      revert_commit: applied.commit,
    });
    if (!updated) return { status: 500, body: { error: 'apply_failed' } };
    return { status: 200, body: { ok: true, id, commit: applied.commit, old_value: oldValue } };
  } catch {
    return { status: 500, body: { error: 'apply_failed' } };
  }
}
