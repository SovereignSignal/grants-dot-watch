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
  status: 'active' | 'winding-down' | 'dormant' | 'unknown';
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
  live_rounds: number;
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
  state: 'pending' | 'approved' | 'rejected';
  created_at: string;
  decided_at?: string;
  decision_note?: string;
}

export interface Verdict {
  proposal_id: string;
  decision: 'approved' | 'rejected';
  note?: string;
  at: string;
  commit?: string | null;
}
