// Registry entity types — mirror of registry/SCHEMA.md. Files are the truth;
// these are their in-memory shape plus derived aggregates.

export type Wire = 'crypto' | 'ai' | 'oss';

export interface System {
  id: string;
  name: string;
  kind: 'protocol-ecosystem' | 'funding-domain';
  part_of: string[];
  wires: Wire[];
  summary: string;
  funding_channels: string[];
  sources: string[];
}

export interface Org {
  id: string;
  name: string;
  aka: string[];
  systems: string[];
  wires: Wire[];
  roles: ('funder' | 'grantee' | 'ecosystem')[];
  org_type?: 'foundation' | 'dao' | 'company' | 'nonprofit' | 'government' | 'education';
  website?: string;
  socials?: Record<string, string>;
  status: 'active' | 'winding-down' | 'dormant' | 'dead' | 'unknown';
  profile: string;
  funding?: {
    focus?: string[];
    typical_size?: string;
    cadence?: string;
    apply_url?: string;
  };
  sources: string[];
}

export interface Round {
  name: string;
  status: 'announced' | 'open' | 'reviewing' | 'closed' | 'deployed' | 'withdrawn' | 'duplicate';
  opens?: string;
  closes?: string;
  /** Source-stated cutoff, including its UTC offset. Never inferred from a date. */
  closes_at?: string;
  size?: string;
  source?: string;
}

export interface Program {
  id: string;
  name: string;
  org: string;
  parent?: string | null;
  /** Preserved call page: exact round name under parent, not a separate program. */
  parent_round?: string | null;
  systems: string[];
  wires: Wire[];
  status: 'active' | 'paused' | 'concluded' | 'announced' | 'unknown';
  mechanism?: 'grants' | 'retro' | 'quadratic' | 'prize' | 'fellowship' | 'incubator' | 'rfp' | 'other';
  apply_url?: string;
  summary: string;
  rounds: Round[];
  sources: string[];
  /** Research assessment, independent of application rounds and file load time. */
  review?: ProgramReview;
}

export interface ProgramReview {
  checked_on: string;
  review_after: string;
  operating: Program['status'];
  intake: 'open' | 'closed' | 'postponed' | 'unknown';
  intake_note: string;
  source: string;
  kind: 'program' | 'unresolved';
  relationship: 'current' | 'former' | 'unconfirmed';
  relationship_note?: string;
  questions: string[];
  history: { date: string; label: string; summary: string; source: string }[];
  intake_mode?: 'rolling' | 'rounds' | 'unknown';
  /** Application windows actually covered by this assessment. */
  round_names?: string[];
  facts?: Partial<Record<'eligibility' | 'geography' | 'funding' | 'deadline', {
    value: string;
    source: string;
    checked_on: string;
  }>>;
}

export interface Award {
  funder: string;
  funder_name: string;
  grantee: string;
  grantee_name: string;
  amount: number | null;
  currency: string | null;
  amount_text: string | null;
  date: string | null;
  program: string | null;
  program_name: string | null;
  wire: Wire | null;
  source: string | null;
  key: string;
}

/** Derived, not curated: built from awards at load time. */
export interface Grantee {
  slug: string;
  name: string;
  awards: Award[];
  funders: string[]; // org ids/slugs that funded it
  total_known: number; // sum of USD-known amounts
  org_id?: string; // set when a curated org file exists for this grantee
}

export interface OrgStats {
  awards_given: number;
  awards_total_usd: number;
  grantees: number;
  programs: number;
  live_rounds: number; // rounds the registry LISTS as current — inventory, not a claim
  last_activity: string | null; // latest dated award/round evidence
}

export interface RegistryIndex {
  systems: System[];
  orgs: Org[];
  programs: Program[];
  awards: Award[];
  grantees: Grantee[];
  orgStats: Map<string, OrgStats>;
  bySystem: Map<string, { orgs: Org[]; programs: Program[] }>;
  loadedAt: string;
  updatedAt: string;
  counts: { systems: number; orgs: number; funders: number; programs: number; awards: number; grantees: number };
}

// ---- The Desk (curation queue) ----

export type ProposalType =
  | 'new_org'
  | 'new_program'
  | 'round_update'
  | 'deadline_change'
  | 'status_change'
  | 'new_award'
  | 'profile_note'
  | 'merge_orgs';

/** Result of a deterministic proposal-validator.ts run, persisted onto a
 *  still-pending proposal when the machine check fails — the Desk's
 *  exception queue reads this straight off the record, no re-run needed. */
export interface ProposalValidation {
  checks: { name: string; pass: boolean; detail?: string }[];
  reason: string;
  checked_at: string;
  /** true for classes that are never machine-validated by design (new_award,
   *  merge_orgs, unrecognized types) — the Desk shows "needs the owner"
   *  instead of "machine check failed" for these. */
  never_auto?: boolean;
}

export interface Proposal {
  id: string;
  type: ProposalType;
  org: string | null;
  org_name?: string | null;
  program?: string | null;
  title: string;
  summary: string;
  evidence_url?: string | null;
  proposed_change?: Record<string, unknown>;
  confidence?: number;
  signal_id?: number | string;
  wire?: Wire | null;
  lane: 'judgment' | 'fact';
  state: 'pending' | 'applying' | 'approved' | 'rejected';
  created_at: string;
  applying_at?: string;
  decided_at?: string;
  decision_note?: string;
  /** Set by validation-runner.ts on a FAIL — cleared implicitly once the
   *  proposal is later approved/rejected by any path (a decided proposal's
   *  validation record is just history at that point). */
  validation?: ProposalValidation;
  /** Set when a curator API key queued this item. Absent on miner/owner intake. */
  submitted_by?: CuratorStamp;
  /** Set by the daily award-source sweep on the funding packets it queues, so a
   *  later run can retry its own still-pending clean packets. */
  origin?: 'award_source_sweep';
  /** Latest curator annotation. Does not decide the item — the owner does. */
  curator_review?: CuratorReview;
  /** Every annotation, oldest first. `curator_review` is the last entry. */
  curator_review_history?: CuratorReview[];
}

/** A curator's note on a still-pending proposal. Stored on the proposal JSON.
 *  Latest wins for display; history keeps the earlier notes. */
export interface CuratorReview {
  verdict: 'approve' | 'reject' | 'needs_owner';
  reason: string;
  sources: { url: string; quote: string }[];
  facts?: CuratorReviewFacts;
  key_id: string;
  key_name: string;
  at: string;
}

/** Facts the curator says the proposal has wrong. Only the fields they send. */
export interface CuratorReviewFacts {
  status?: string;
  deadline?: string;
  amount?: string;
  org_name?: string;
  program_name?: string;
}

/** Who queued a proposal through the curator API. Stored on the proposal
 *  JSON, so the Desk Log can label it without a separate table. */
export interface CuratorStamp {
  key_id: string;
  key_name: string;
  reason: string;
  sources: string[];
  quotes: { url: string; quote: string }[];
  at: string;
}

export interface Verdict {
  proposal_id: string;
  decision: 'approved' | 'rejected';
  note?: string;
  at: string;
  commit?: string | null;
  /** Who decided — omitted (not defaulted) for every pre-existing verdict,
   *  so backward compat needs no migration: absent means owner. The
   *  machine-validation pipeline writes 'machine'. The curator API writes
   *  'curator' plus the key id and name. */
  by?: 'machine' | 'owner' | 'curator';
  curator_id?: string;
  curator_name?: string;
  /** Source URLs the curator attached to this decision. */
  sources?: string[];
  /** Set when this approval was an automatic low-risk apply. The Desk Log
   *  reads it for the auto-apply actor, the filter, and one-click revert. */
  auto_apply?: CuratorAutoApply;
  /** Set when the award-source auto-apply approved a clean first-party
   *  funding packet (by is 'machine'). Funding ledgers are append-only, so
   *  this has no one-click revert. */
  award_auto_apply?: AwardAutoApply;
  /** Set when the Wire program auto-apply approved a new program for a known
   *  org after confirming it on the org's own site (by is 'machine'). */
  wire_program_auto_apply?: WireProgramAutoApply;
  /** Set when the daily review recheck renewed a program's review dates after
   *  re-fetching its official page (by is 'machine'). */
  review_recheck_auto_apply?: ReviewRecheckAutoApply;
  /** Set when an owner reverted this auto-apply. */
  reverted_at?: string;
  revert_commit?: string | null;
}

/** Audit for one automatic low-risk apply. Stored on the verdict JSON. */
export interface CuratorAutoApply {
  key_id: string;
  fetched_url: string | null;
  page_hash: string | null;
  old_value: string | null;
  new_value: string | null;
}

/** Audit for one award-source auto-apply. Stored on the verdict JSON. */
export interface AwardAutoApply {
  policy: string;
  source: string;
  source_url: string;
  pack_id: string;
  plan_digest: string;
  records: number;
}

/** Audit for one Wire program auto-apply. Stored on the verdict JSON. */
export interface WireProgramAutoApply {
  policy: string;
  /** The URL the server asked for, and the URL that answered after redirects. */
  fetched_url: string;
  final_url: string;
  /** SHA-256 of the fetched page bytes. */
  page_hash: string;
  /** The normalized name phrase found on the page. */
  matched_name: string;
  /** `phrase: <open phrase>` or `deadline: <YYYY-MM-DD>`. */
  matched_signal: string;
  /** Set when the round carries a Wire amount: the amount as queued, and the
   *  page text that states it (same currency, same value). */
  amount?: string;
  matched_amount?: string;
  /** The Wire source score. */
  score: number;
}

/** Audit for one review renewal by the daily recheck. Stored on the verdict JSON. */
export interface ReviewRecheckAutoApply {
  policy: string;
  program_id: string;
  /** The review source the server asked for, and the URL that answered after redirects. */
  fetched_url: string;
  final_url: string;
  /** SHA-256 of the fetched page bytes. */
  page_hash: string;
  /** The normalized program name found on the page. */
  matched_name: string;
  /** The recorded intake and the phrase that supports it, e.g. `open: apply now`. */
  matched_intake: string;
  /** The review dates before and after the renewal. */
  previous_checked_on: string;
  previous_review_after: string;
  checked_on: string;
  review_after: string;
}
