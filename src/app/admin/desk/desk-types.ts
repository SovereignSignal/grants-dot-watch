// Shapes for The Desk's own API responses — supersets of the shared registry
// types (@/lib/types) with the queue's WHERE/VALIDATE enrichment. Kept local
// to admin/desk since nothing outside The Desk needs them.
import type { ProposalType, Proposal, Wire } from '@/lib/types';
import type { SignalEvidence } from '@/lib/signal-lookup';

/** A Proposal as /api/desk/queue actually returns it: destination paths and
 *  joined wire-signal evidence computed server-side, so a card never needs a
 *  round trip just to answer WHERE and VALIDATE. */
export interface QueueProposal extends Proposal {
  destination: string[] | null;
  destination_error: string | null;
  evidence: SignalEvidence | null;
}

export interface FieldDiff {
  field: string;
  before: string;
  after: string;
}

export interface PreviewChange {
  path: string;
  op: 'create' | 'update' | 'append';
  heading: string;
  content: string;
  diff?: FieldDiff[];
}

export interface PreviewPayload {
  changes: PreviewChange[];
  notes: string[];
}

/** /api/desk/decide-bulk's response shape. */
export interface DecideBulkResponse {
  ok: true;
  decided: string[];
  failed: { id: string; error: string }[];
  commit: string | null;
}

export type ConfidenceBand = 'all' | 'high' | 'mid' | 'low';
export type SourceFilter = 'all' | 'sourced' | 'unsourced';
export type CuratorVerdictFilter = 'all' | 'approve' | 'reject' | 'needs_owner' | 'unreviewed';

/** Judgment-tab filter state, lifted to page.tsx so it survives group
 *  collapse/expand. `confidence` stays as the compatibility field name for
 *  the source-supplied score. `proposers` empty means every proposer. */
export interface FilterState {
  types: Set<ProposalType>; // empty = all types
  wires: Set<Wire>; // empty = all wires
  confidence: ConfidenceBand;
  source: SourceFilter;
  curator: CuratorVerdictFilter;
  proposers: Set<string>;
  text: string;
}

export const DEFAULT_FILTERS: FilterState = {
  types: new Set(),
  wires: new Set(),
  confidence: 'all',
  source: 'all',
  curator: 'all',
  proposers: new Set(),
  text: '',
};
