// Desk Log rows. Verdicts stay the decision record. Curator submissions are
// added beside them so a queued proposal is visible before anyone decides it.
import type { CuratorStamp, Proposal, Verdict } from './types';

export interface DeskLogAudit {
  keyId: string;
  fetchedUrl: string | null;
  pageHash: string | null;
  oldValue: string | null;
  newValue: string | null;
}

export interface DeskLogAwardAudit {
  policy: string;
  source: string;
  sourceUrl: string;
  packId: string;
  planDigest: string;
  records: number;
}

export interface DeskLogProgramAudit {
  policy: string;
  fetchedUrl: string;
  finalUrl: string;
  pageHash: string;
  matchedName: string;
  matchedSignal: string;
  matchedAmount?: string;
  score: number;
}

export interface DeskLogRow {
  key: string;
  at: string;
  action: 'approved' | 'rejected' | 'queued';
  title: string;
  note?: string;
  commit?: string | null;
  actor: string | null;
  destination?: string[] | null;
  proposalId?: string;
  autoApplied?: boolean;
  /** One-click revert exists only for curator X-handle auto-applies. */
  revertable?: boolean;
  reverted?: boolean;
  audit?: DeskLogAudit;
  awardAudit?: DeskLogAwardAudit;
  programAudit?: DeskLogProgramAudit;
}

function curatorActor(name: string | undefined, id: string | undefined): string {
  return `curator · ${name || id || 'curator'}`;
}

function verdictActor(verdict: Verdict): string | null {
  if (verdict.by === 'machine') {
    if (verdict.award_auto_apply) return 'machine · award auto-apply';
    if (verdict.wire_program_auto_apply) return 'machine · wire program auto-apply';
    if (verdict.review_recheck_auto_apply) return 'machine · review renewal';
    return 'machine';
  }
  if (verdict.by === 'curator') {
    const actor = curatorActor(verdict.curator_name, verdict.curator_id);
    return verdict.auto_apply ? `${actor} · auto-apply` : actor;
  }
  return null;
}

export function buildDeskLog(
  proposals: Array<Pick<Proposal, 'id' | 'title' | 'submitted_by'> & { destination?: string[] | null }>,
  verdicts: Verdict[]
): DeskLogRow[] {
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const rows: DeskLogRow[] = [];
  for (const verdict of verdicts) {
    const proposal = byId.get(verdict.proposal_id);
    rows.push({
      key: `verdict:${verdict.proposal_id}:${verdict.at}`,
      at: verdict.at,
      action: verdict.decision,
      title: proposal?.title || verdict.proposal_id,
      note: verdict.note,
      commit: verdict.commit ?? null,
      actor: verdictActor(verdict),
      destination: verdict.decision === 'approved' ? proposal?.destination ?? null : null,
      proposalId: verdict.proposal_id,
      autoApplied: Boolean(verdict.auto_apply || verdict.award_auto_apply || verdict.wire_program_auto_apply || verdict.review_recheck_auto_apply),
      revertable: Boolean(verdict.auto_apply),
      reverted: Boolean(verdict.reverted_at),
      audit: verdict.auto_apply
        ? {
            keyId: verdict.auto_apply.key_id,
            fetchedUrl: verdict.auto_apply.fetched_url,
            pageHash: verdict.auto_apply.page_hash,
            oldValue: verdict.auto_apply.old_value,
            newValue: verdict.auto_apply.new_value,
          }
        : undefined,
      awardAudit: verdict.award_auto_apply
        ? {
            policy: verdict.award_auto_apply.policy,
            source: verdict.award_auto_apply.source,
            sourceUrl: verdict.award_auto_apply.source_url,
            packId: verdict.award_auto_apply.pack_id,
            planDigest: verdict.award_auto_apply.plan_digest,
            records: verdict.award_auto_apply.records,
          }
        : undefined,
      programAudit: verdict.wire_program_auto_apply
        ? {
            policy: verdict.wire_program_auto_apply.policy,
            fetchedUrl: verdict.wire_program_auto_apply.fetched_url,
            finalUrl: verdict.wire_program_auto_apply.final_url,
            pageHash: verdict.wire_program_auto_apply.page_hash,
            matchedName: verdict.wire_program_auto_apply.matched_name,
            matchedSignal: verdict.wire_program_auto_apply.matched_signal,
            ...(verdict.wire_program_auto_apply.matched_amount ? { matchedAmount: verdict.wire_program_auto_apply.matched_amount } : {}),
            score: verdict.wire_program_auto_apply.score,
          }
        : undefined,
    });
  }
  for (const proposal of proposals) {
    const stamp: CuratorStamp | undefined = proposal.submitted_by;
    if (!stamp) continue;
    rows.push({
      key: `queued:${proposal.id}`,
      at: stamp.at,
      action: 'queued',
      title: proposal.title,
      note: stamp.reason,
      actor: curatorActor(stamp.key_name, stamp.key_id),
      destination: null,
    });
  }
  rows.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  return rows;
}
