// Award-source auto-apply (AWARD_SOURCES_AUTO_APPLY=1). The daily sweep calls
// this for each new packet it previewed, and for each of its own packets still
// pending from an earlier run. A clean packet (see funding-source-clean.mjs and
// machine-approval-policy.ts) is re-previewed against current canonical bytes
// and approved through decideProposal, the owner Desk path, as a machine
// decision. Anything else stays a pending Desk item.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { decideProposal, proposalChangeHash } from './desk-decide';
import { previewFundingPack } from './funding-desk-service.mjs';
import { mappingReasons, packRecords, packetReasons } from './funding-source-clean.mjs';
import { SOURCE_CATALOG } from './funding-source-adapters.mjs';
import { AWARD_AUTO_APPLY_POLICY } from './machine-approval-policy';
import type { AwardAutoApplyInput, AwardAutoApplyOutcome, QueuedSweepProposal } from './funding-source-sweep.mjs';
import type { AwardAutoApply } from './types';

/** Approvals per daily run. Each one runs the full funding validation, so the
 *  cap also bounds how long the timer holds the event loop in total. */
export const MAX_AWARD_AUTO_APPLIES = 10;

type Snapshot = { root: string; baseline: unknown; dataset?: unknown };
type Preview = { plan_digest: string; added: object; unchanged: object };

export interface AwardAutoApplyDeps {
  load: () => Promise<Snapshot> | Snapshot;
  decide?: typeof decideProposal;
  /** True while another funding-aware Desk writer holds the lock. */
  writerBusy?: () => boolean;
  now?: () => Date;
  yieldTurn?: () => Promise<void>;
  maxApplies?: number;
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);
const WRITER_BUSY = /funding writer is active|funding-aware Desk writer is active/i;
const digestOf = (proposal: QueuedSweepProposal | null | undefined) =>
  typeof proposal?.signal_id === 'string' && proposal.signal_id.startsWith('funding-v2:') ? proposal.signal_id.slice('funding-v2:'.length) : null;

export function localWriterBusy(): boolean {
  return existsSync(join(process.cwd(), '.data', 'funding-writer.lock'));
}

/** One hook per sweep run. It counts approvals against the per-run cap, works
 *  one packet at a time, and stops approving after a reconciliation hold. */
export function createAwardAutoApply(deps: AwardAutoApplyDeps) {
  const decide = deps.decide ?? decideProposal;
  const writerBusy = deps.writerBusy ?? localWriterBusy;
  const pause = deps.yieldTurn ?? turn;
  const now = deps.now ?? (() => new Date());
  const cap = deps.maxApplies ?? MAX_AWARD_AUTO_APPLIES;
  let applied = 0;
  let halted: string | null = null;

  /** Re-preview against the current canonical bytes, with the mapping check. */
  async function rePreview(source: string, pack: unknown): Promise<{ preview: Preview; reasons: string[] } | { error: string }> {
    await pause();
    try {
      const snapshot = await deps.load();
      const preview = (await previewFundingPack(pack, () => snapshot, now())) as Preview;
      return { preview, reasons: mappingReasons(source, pack, snapshot.baseline) };
    } catch (error) {
      return { error: WRITER_BUSY.test(message(error)) ? 'writer_busy' : `re_preview_failed: ${message(error)}` };
    }
  }

  return async function autoApply(input: AwardAutoApplyInput): Promise<AwardAutoApplyOutcome> {
    const { source, compiled, pack } = input;
    const retry = !input.queue;
    /** Not approved now. A new packet is queued for the owner; a retry stays pending. */
    const leave = async (reasons: string[], proposal?: QueuedSweepProposal | null): Promise<AwardAutoApplyOutcome> => {
      if (proposal === undefined && input.queue) {
        const queued = await input.queue();
        if (!queued) return { status: 'repeated', reasons: [], proposal_id: null };
        return { status: 'left', reasons, proposal_id: queued.id };
      }
      return { status: 'left', reasons, proposal_id: (proposal ?? input.proposal)?.id ?? null };
    };

    if (halted) return leave([halted]);
    let preview = input.preview as Preview | undefined;
    const reasons: string[] = [];
    if (retry) {
      // A retry is re-previewed now, and must still be the exact queued plan.
      if (!input.proposal?.id || !digestOf(input.proposal)) return leave(['queued_proposal_mismatch']);
      if (writerBusy()) return leave(['writer_busy']);
      const fresh = await rePreview(source, pack);
      if ('error' in fresh) return leave([fresh.error]);
      preview = fresh.preview;
      reasons.push(...fresh.reasons);
      if (fresh.preview.plan_digest !== digestOf(input.proposal)) reasons.push('preview_changed');
    }
    reasons.unshift(...packetReasons({ source, compiled, pack, preview }));
    if (reasons.length) return leave(reasons);

    // Clean. A cap or busy writer defers a new packet to the next run without
    // queueing it, so it is never left with a stale plan; a retry stays pending.
    const transient = applied >= cap ? 'auto_apply_cap' : writerBusy() ? 'writer_busy' : null;
    if (transient) return retry ? leave([transient]) : { status: 'deferred', reasons: [transient], proposal_id: null };

    let proposal = input.proposal ?? null;
    const queuedDigest = (preview as Preview).plan_digest;
    if (!retry) {
      proposal = await input.queue!();
      if (!proposal) return { status: 'repeated', reasons: [], proposal_id: null };
      if (digestOf(proposal) !== queuedDigest) return leave(['queued_proposal_mismatch'], proposal);
      // Re-preview against the current canonical bytes, right before applying.
      const fresh = await rePreview(source, pack);
      if ('error' in fresh) return leave([fresh.error], proposal);
      if (fresh.reasons.length) return leave(fresh.reasons, proposal);
      if (fresh.preview.plan_digest !== queuedDigest) return leave(['preview_changed'], proposal);
      preview = fresh.preview;
    }
    const records = packRecords(pack)?.length ?? 0;
    const total = (counts: object) => Object.values(counts).reduce((n: number, v) => n + (Number(v) || 0), 0);
    if (total((preview as Preview).added) !== records || total((preview as Preview).unchanged) !== 0) return leave(['not_all_records_new'], proposal);
    if (writerBusy()) return leave(['writer_busy'], proposal);

    await pause();
    const audit: AwardAutoApply = {
      policy: AWARD_AUTO_APPLY_POLICY,
      source,
      source_url: SOURCE_CATALOG[source as keyof typeof SOURCE_CATALOG].url,
      pack_id: (pack as { id: string }).id,
      plan_digest: queuedDigest,
      records,
    };
    // decideProposal's claim makes this the only approval of the proposal.
    const result = await decide({
      id: (proposal as QueuedSweepProposal).id,
      decision: 'approved',
      by: 'machine',
      note: `auto: clean first-party award packet from ${source} (${records} records, ${AWARD_AUTO_APPLY_POLICY})`,
      award_auto_apply: audit,
      // The queued payload whose digest was checked above.
      expect_change_hash: proposalChangeHash((proposal as QueuedSweepProposal).proposed_change),
    });
    await pause();
    if (result.status === 200) {
      applied++;
      return { status: 'applied', reasons: [], proposal_id: (proposal as QueuedSweepProposal).id };
    }
    const error = result.body.error || `status_${result.status}`;
    if (result.body.reconciliation_hold) {
      // The registry may have changed under this packet: stop for the run.
      halted = 'halted_after_reconciliation_hold';
      return leave(['reconciliation_hold'], proposal);
    }
    return leave([WRITER_BUSY.test(error) ? 'writer_busy' : `apply_failed: ${error.slice(0, 200)}`], proposal);
  };
}
