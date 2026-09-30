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
  status: 'announced' | 'open' | 'reviewing' | 'closed' | 'deployed';
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
}
