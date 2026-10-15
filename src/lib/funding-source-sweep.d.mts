/** Type contract for the runtime-validated daily award-source sweep. */
export const MAX_SWEEP_PREVIEWS: number;
export interface AwardSourceSweepRow {
  source: string;
  status: 'ok' | 'failed';
  packets: number;
  queued: number;
  repeated: number;
  held: number;
  deferred: number;
  records_held: number;
  auto_applied: number;
  error: string | null;
}
/** A packet the owner still decides: queued and left pending, or held unqueued. */
export interface AwardSourceLeftForOwner {
  source: string;
  pack_id: string;
  proposal_id: string | null;
  queued: boolean;
  reasons: string[];
}
export interface AwardAutoApplyOutcome {
  applied: boolean;
  reasons: string[];
}
export interface AwardAutoApplyInput {
  source: string;
  compiled: unknown;
  pack: unknown;
  preview: unknown;
  proposal: { id: string; signal_id?: string | null } & Record<string, unknown>;
}
export interface AwardSourceSweepSummary {
  at: string;
  enabled: boolean;
  skipped: 'award_sources_disabled' | 'funding_desk_disabled' | 'desk_queue_unavailable' | null;
  error?: string;
  sources_tried: number;
  sources_failed: number;
  packets_queued: number;
  packets_repeated: number;
  packets_held: number;
  packets_deferred: number;
  records_held: number;
  duration_ms: number;
  sources: AwardSourceSweepRow[];
  /** True only when AWARD_SOURCES_AUTO_APPLY=1 wired the auto-apply hook. */
  approval: boolean;
  auto_applied: number;
  left_for_owner: AwardSourceLeftForOwner[];
}
export interface AwardSourceSweepDependencies {
  enabled: boolean;
  fundingDeskEnabled: boolean;
  capture: (source: string, fund: number, revision: string | null) => Promise<{ bundle: { snapshots: unknown[] }; receipt: unknown }>;
  load: () => unknown | Promise<unknown>;
  proposals: () => Promise<unknown[]>;
  enqueue: (rows: unknown[]) => Promise<{ inserted: unknown[]; skipped: number }>;
  sources?: readonly string[];
  now?: () => Date;
  yieldTurn?: () => Promise<void>;
  maxPreviews?: number;
  afterQueue?: (input: AwardAutoApplyInput) => Promise<AwardAutoApplyOutcome>;
}
export function sweepAwardSources(dependencies: AwardSourceSweepDependencies): Promise<AwardSourceSweepSummary>;
