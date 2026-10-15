// Daily Desk upkeep. Rides the daily ingest run (src/lib/ingest.ts) after the
// Wire ingest and the award sweep, inside the same lock and day claim. Off
// unless DESK_UPKEEP_ENABLED=1.
//
// X-handle backlog: pending curator X-handle notes filed before the submit-time
// auto-apply existed get the exact same check (curator-auto-apply.ts
// assessXHandleApply) and, when it passes, the same decideProposal approval
// with the same audit. Like submit time, it acts only for a filing curator key
// that is still active, unrevoked and holds `apply_low_risk`; a note without a
// curator stamp is never approved. Clears are never approved here.
//
// It reads pending proposals only, works one item at a time, and yields to the
// event loop between items. Any failure leaves the item pending.
import {
  assessXHandleApply,
  autoApplyNote,
  curatorAutoApplyEnabled,
  curatorAutoApplyTypes,
  fetchEvidencePage,
  orgXState,
  readXHandleEdit,
  type PageFetch,
} from './curator-auto-apply';
import { curatorKeyStanding, type CuratorKeyStanding } from './curator-auth';
import { proposalBlocked } from './curator-proposals';
import { decideProposal, type DecideInput, type DecideResult } from './desk-decide';
import { listProposals } from './desk-store';
import { isFundingProposal } from './funding-desk-core.mjs';
import { loadRegistry } from './registry';
import type { Org, Proposal } from './types';

/** Assessments per run. Each one may fetch a page (8s timeout, 1 MB cap). */
export const X_HANDLE_BACKLOG_CAP = 25;

export function deskUpkeepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DESK_UPKEEP_ENABLED === '1';
}

export interface DeskUpkeepSummary {
  at: string;
  skipped: 'desk_upkeep_disabled' | null;
  /** Why the X-handle pass did not run, when it did not. */
  x_handles_skipped: 'auto_apply_disabled' | 'x_handle_not_allowed' | null;
  x_handles_applied: number;
  /** Pending X-handle notes still pending after this run. */
  x_handles_left: number;
  /** Why each left item stayed pending, counted by reason. */
  x_handles_reasons: Record<string, number>;
  errors: string[];
}

export interface DeskUpkeepDeps {
  listPending: () => Promise<Proposal[]>;
  decide: (input: DecideInput) => Promise<DecideResult>;
  orgs: () => readonly Org[];
  fetchPage: (url: string, allowedDomain: string) => Promise<PageFetch>;
  /** The filing key's current standing, from the same key store as `authorize`. */
  curatorKey: (id: string) => CuratorKeyStanding;
  autoApplyEnabled: () => boolean;
  autoApplyTypes: () => Set<string>;
  enabled: () => boolean;
  now: () => Date;
  pause: () => Promise<void>;
}

export const defaultDeskUpkeepDeps: DeskUpkeepDeps = {
  listPending: () => listProposals({ state: 'pending' }),
  decide: (input) => decideProposal(input),
  orgs: () => loadRegistry().orgs,
  fetchPage: (url, domain) => fetchEvidencePage(url, domain),
  curatorKey: (id) => curatorKeyStanding(id),
  autoApplyEnabled: () => curatorAutoApplyEnabled(),
  autoApplyTypes: () => curatorAutoApplyTypes(),
  enabled: () => deskUpkeepEnabled(),
  now: () => new Date(),
  pause: () => new Promise((resolve) => setImmediate(resolve)),
};

function bump(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] || 0) + 1;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** A pending, non-funding profile note that only sets or clears one org's X handle. */
function backlogXHandle(proposal: Proposal) {
  if (proposal.state !== 'pending' || proposal.type !== 'profile_note') return null;
  if (isFundingProposal(proposal) || proposalBlocked(proposal)) return null;
  return readXHandleEdit(proposal.proposed_change);
}

async function applyXHandleBacklog(pending: Proposal[], deps: DeskUpkeepDeps, summary: DeskUpkeepSummary): Promise<Set<string>> {
  const decided = new Set<string>();
  const items = pending.flatMap((proposal) => {
    const edit = backlogXHandle(proposal);
    return edit ? [{ proposal, edit }] : [];
  });
  if (!items.length) return decided;
  if (!deps.autoApplyTypes().has('x_handle')) {
    summary.x_handles_skipped = 'x_handle_not_allowed';
    summary.x_handles_left = items.length;
    return decided;
  }
  if (!deps.autoApplyEnabled()) {
    summary.x_handles_skipped = 'auto_apply_disabled';
    summary.x_handles_left = items.length;
    return decided;
  }
  let assessed = 0;
  for (const { proposal, edit } of items) {
    if (edit.clear) {
      bump(summary.x_handles_reasons, 'clear_not_auto');
      continue;
    }
    // Only a note a curator filed can be applied, and only while that key
    // could auto-apply it at submit time: active, unrevoked, apply_low_risk.
    const stamp = proposal.submitted_by;
    if (!stamp) {
      bump(summary.x_handles_reasons, 'no_curator_stamp');
      continue;
    }
    const standing = deps.curatorKey(stamp.key_id);
    if (standing.status !== 'active') {
      bump(summary.x_handles_reasons, `curator_key_${standing.status}`);
      continue;
    }
    const identity = standing.identity;
    if (!identity.scopes.includes('apply_low_risk')) {
      bump(summary.x_handles_reasons, 'curator_lacks_apply_low_risk');
      continue;
    }
    if (assessed >= X_HANDLE_BACKLOG_CAP) {
      bump(summary.x_handles_reasons, 'over_cap');
      continue;
    }
    assessed += 1;
    if (assessed > 1) await deps.pause();
    try {
      const current = orgXState(deps.orgs(), edit.orgId);
      const result = await assessXHandleApply({
        edit,
        website: current.website,
        oldValue: current.oldValue,
        quotes: stamp.quotes || [],
        fetchPage: deps.fetchPage,
        keyId: identity.id,
      });
      if (!result.ok) {
        bump(summary.x_handles_reasons, result.reason);
        continue;
      }
      const decision = await deps.decide({
        id: proposal.id,
        decision: 'approved',
        note: autoApplyNote(`daily backlog check. ${stamp.reason || 'X handle linked from the organization site.'}`),
        by: 'curator',
        curator_id: identity.id,
        curator_name: identity.name,
        sources: stamp.sources,
        auto_apply: result.audit,
      });
      if (decision.status === 200 && decision.body.proposal) {
        summary.x_handles_applied += 1;
        decided.add(proposal.id);
      } else {
        bump(summary.x_handles_reasons, 'apply_failed');
      }
    } catch (error) {
      bump(summary.x_handles_reasons, 'apply_failed');
      summary.errors.push(`${proposal.id}: ${errorText(error, 'x handle apply failed')}`);
    }
  }
  summary.x_handles_left = items.length - summary.x_handles_applied;
  return decided;
}

/** One daily pass. Never throws: a failure is recorded on the summary. */
export async function runDeskUpkeep(deps: DeskUpkeepDeps = defaultDeskUpkeepDeps): Promise<DeskUpkeepSummary> {
  const summary: DeskUpkeepSummary = {
    at: deps.now().toISOString(),
    skipped: null,
    x_handles_skipped: null,
    x_handles_applied: 0,
    x_handles_left: 0,
    x_handles_reasons: {},
    errors: [],
  };
  if (!deps.enabled()) {
    summary.skipped = 'desk_upkeep_disabled';
    return summary;
  }
  let pending: Proposal[];
  try {
    pending = await deps.listPending();
  } catch (error) {
    summary.errors.push(`queue: ${errorText(error, 'pending queue unavailable')}`);
    return summary;
  }
  try {
    await applyXHandleBacklog(pending, deps, summary);
  } catch (error) {
    summary.errors.push(`x handles: ${errorText(error, 'x handle pass failed')}`);
  }
  return summary;
}
