// Production wiring for the daily award-source sweep (src/lib/funding-source-sweep.mjs)
// and the per-source capture guard it shares with the owner workspace.
import { insertIngestProposals, listProposals, type RawMinerProposal } from './desk-store';
import { isFundingProposal } from './funding-desk-core.mjs';
import { captureMicrosoftFund } from './funding-source-native.mjs';
import { captureMicrosoftArchive } from './funding-source-native-batch.mjs';
import { captureFundingTable } from './funding-source-html.mjs';
import { sweepAwardSources, type AwardSourceSweepSummary } from './funding-source-sweep.mjs';
import { loadFundingEditableSnapshot } from './public-api-v2';
import { awardSourcesAutoApplyEnabled } from './machine-approval-policy';

type CaptureState = { active: boolean; starts: number[] };
// Next bundles instrumentation (the ingest timer) and route handlers as
// separate module instances, so the guard lives on globalThis to stay one
// guard per process: four starts per minute and one active capture per source.
const GUARD = Symbol.for('grants.watch.funding-source-captures');
const store = globalThis as typeof globalThis & { [GUARD]?: Map<string, CaptureState> };
const captures = (store[GUARD] ??= new Map<string, CaptureState>());

export async function captureFundingSource(source: string, fund: number, revision: string | null) {
  const now = Date.now(), state = captures.get(source) || { active: false, starts: [] };
  state.starts = state.starts.filter(t => now - t < 60_000);
  if (state.active || state.starts.length >= 4) throw new Error('source_capture_busy');
  state.active = true; state.starts.push(now); captures.set(source, state);
  try {
    if (source === 'microsoft-foss') return fund === 0
      ? await captureMicrosoftArchive({ revision })
      : await captureMicrosoftFund({ fund, revision });
    return await captureFundingTable(source);
  } finally { state.active = false; }
}

/** Off unless AWARD_SOURCES_ENABLED=1. Queues pending Desk items through the
 *  same preview and insert the workspace uses. With AWARD_SOURCES_AUTO_APPLY=1
 *  (independent, default off) a clean packet is approved right after it is
 *  queued, through the owner Desk path as a machine decision
 *  (src/lib/award-auto-apply.ts). Never throws. */
export async function runAwardSourceSweep(): Promise<AwardSourceSweepSummary> {
  const afterQueue = awardSourcesAutoApplyEnabled()
    ? (await import('./award-auto-apply')).createAwardAutoApply({ load: loadFundingEditableSnapshot })
    : undefined;
  return sweepAwardSources({
    enabled: process.env.AWARD_SOURCES_ENABLED === '1',
    fundingDeskEnabled: process.env.GRANTS_WATCH_FUNDING_DESK === '1',
    capture: captureFundingSource,
    load: loadFundingEditableSnapshot,
    proposals: async () => (await listProposals()).filter(isFundingProposal),
    enqueue: rows => insertIngestProposals(rows as RawMinerProposal[]),
    afterQueue,
  });
}
