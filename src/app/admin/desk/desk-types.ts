// Shapes for The Desk's own API responses — supersets of the shared registry
// types (@/lib/types) with the queue's WHERE/VALIDATE enrichment. Kept local
// to admin/desk since nothing outside The Desk needs them.
import type { Proposal } from '@/lib/types';
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
