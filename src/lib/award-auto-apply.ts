// Award-source auto-apply (AWARD_SOURCES_AUTO_APPLY=1). The daily sweep calls
// this right after it queues one packet. A clean packet (see
// funding-source-clean.mjs and machine-approval-policy.ts) is re-previewed
// against current canonical bytes and approved through decideProposal, the
// owner Desk path, as a machine decision. Anything else stays pending.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { decideProposal } from './desk-decide';
import { previewFundingPack } from './funding-desk-service.mjs';
import { mappingReasons, packRecords, packetReasons } from './funding-source-clean.mjs';
import { SOURCE_CATALOG } from './funding-source-adapters.mjs';
import { AWARD_AUTO_APPLY_POLICY } from './machine-approval-policy';
import type { AwardAutoApplyInput, AwardAutoApplyOutcome } from './funding-source-sweep.mjs';
import type { AwardAutoApply } from './types';

/** Approvals per daily run. Each one runs the full funding validation, so the
 *  cap also bounds how long the timer holds the event loop in total. */
export const MAX_AWARD_AUTO_APPLIES = 10;

export interface AwardAutoApplyDeps {
  load: () => Promise<{ root: string; baseline: unknown; dataset?: unknown }> | { root: string; baseline: unknown; dataset?: unknown };
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

export function localWriterBusy(): boolean {
  return existsSync(join(process.cwd(), '.data', 'funding-writer.lock'));
}

/** One hook per sweep run; it counts approvals against the per-run cap and
 *  stops after a reconciliation hold. One packet at a time. */
export function createAwardAutoApply(deps: AwardAutoApplyDeps) {
  const decide = deps.decide ?? decideProposal;
  const writerBusy = deps.writerBusy ?? localWriterBusy;
  const pause = deps.yieldTurn ?? turn;
  const cap = deps.maxApplies ?? MAX_AWARD_AUTO_APPLIES;
  let applied = 0;
  let halted: string | null = null;
  return async function autoApply(input: AwardAutoApplyInput): Promise<AwardAutoApplyOutcome> {
    const { source, compiled, pack, preview, proposal } = input;
    const left = (...reasons: string[]): AwardAutoApplyOutcome => ({ applied: false, reasons });
    if (halted) return left(halted);
    if (applied >= cap) return left('auto_apply_cap');
    const reasons = packetReasons({ source, compiled, pack, preview });
    if (reasons.length) return left(...reasons);
    const queuedDigest = (preview as { plan_digest: string }).plan_digest;
    if (!proposal?.id || proposal.signal_id !== `funding-v2:${queuedDigest}`) return left('queued_proposal_mismatch');
    if (writerBusy()) return left('writer_busy');

    // Re-preview against the current canonical bytes, right before applying.
    await pause();
    let snapshot: Awaited<ReturnType<AwardAutoApplyDeps['load']>>;
    let fresh: { plan_digest: string; added: object; unchanged: object };
    try {
      snapshot = await deps.load();
      fresh = await previewFundingPack(pack, () => snapshot, (deps.now ?? (() => new Date()))());
    } catch (error) {
      return left(WRITER_BUSY.test(message(error)) ? 'writer_busy' : `re_preview_failed: ${message(error)}`);
    }
    const mapping = mappingReasons(source, pack, snapshot.baseline);
    if (mapping.length) return left(...mapping);
    if (fresh.plan_digest !== queuedDigest) return left('preview_changed');
    const records = packRecords(pack)?.length ?? 0;
    const total = (counts: object) => Object.values(counts).reduce((n: number, v) => n + (Number(v) || 0), 0);
    const added = total(fresh.added);
    const unchanged = total(fresh.unchanged);
    if (added !== records || unchanged !== 0) return left('not_all_records_new');
    if (writerBusy()) return left('writer_busy');

    await pause();
    const audit: AwardAutoApply = {
      policy: AWARD_AUTO_APPLY_POLICY,
      source,
      source_url: SOURCE_CATALOG[source as keyof typeof SOURCE_CATALOG].url,
      pack_id: (pack as { id: string }).id,
      plan_digest: queuedDigest,
      records,
    };
    const result = await decide({
      id: proposal.id,
      decision: 'approved',
      by: 'machine',
      note: `auto: clean first-party award packet from ${source} (${records} records, ${AWARD_AUTO_APPLY_POLICY})`,
      award_auto_apply: audit,
    });
    await pause();
    if (result.status === 200) {
      applied++;
      return { applied: true, reasons: [] };
    }
    const error = result.body.error || `status_${result.status}`;
    if (result.body.reconciliation_hold) {
      // The registry may have changed under this packet: stop for the run.
      halted = 'halted_after_reconciliation_hold';
      return left('reconciliation_hold');
    }
    return left(WRITER_BUSY.test(error) ? 'writer_busy' : `apply_failed: ${error.slice(0, 200)}`);
  };
}
