// Shared display helpers for the systems/orgs browsing module. Pure functions
// only — no components here (components live in filters.tsx / cards live inline
// in the pages that own them).
import type { Award, Org, Program, RegistryIndex, System } from '@/lib/types';
import { mostLiveRound } from '@/components/ledger/rounds';

// mostLiveRound is defined once in the ledger module (src/components/ledger/rounds.ts)
// and re-exported here so browse pages can import it alongside the other
// registry-helpers without duplicating the round-priority logic.
export { mostLiveRound };

export const SYSTEM_KIND_LABEL: Record<System['kind'], string> = {
  'protocol-ecosystem': 'Protocol ecosystem',
  'funding-domain': 'Funding domain',
};

export const ORG_TYPE_LABEL: Record<NonNullable<Org['org_type']>, string> = {
  foundation: 'Foundation',
  dao: 'DAO',
  company: 'Company',
  nonprofit: 'Nonprofit',
  government: 'Government',
  education: 'Education',
};

export const ORG_ROLE_LABEL: Record<Org['roles'][number], string> = {
  funder: 'Funder',
  grantee: 'Grantee',
  ecosystem: 'Ecosystem',
};

export const ORG_STATUS_LABEL: Record<Org['status'], string> = {
  active: 'Active',
  'winding-down': 'Winding down',
  dormant: 'Dormant',
  unknown: 'Unknown',
};

export const PROGRAM_STATUS_LABEL: Record<Program['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  concluded: 'Concluded',
  announced: 'Announced',
  unknown: 'Unknown',
};

export const MECHANISM_LABEL: Record<NonNullable<Program['mechanism']>, string> = {
  grants: 'Grants',
  retro: 'Retroactive funding',
  quadratic: 'Quadratic funding',
  prize: 'Prize',
  fellowship: 'Fellowship',
  incubator: 'Incubator',
  rfp: 'RFP',
  other: 'Other',
};

/** Org type falls back to the first role when org_type is unset (thin grantee records). */
export function orgTypeLabel(org: Org): string {
  if (org.org_type) return ORG_TYPE_LABEL[org.org_type] || org.org_type;
  const role = org.roles?.[0];
  return role ? ORG_ROLE_LABEL[role] || role : 'Organization';
}

/** Label lookups fall back to the raw value — seed data isn't fully validated yet. */
export function systemKindLabel(kind: System['kind']): string {
  return SYSTEM_KIND_LABEL[kind] || kind;
}
export function orgStatusLabel(status: Org['status']): string {
  return ORG_STATUS_LABEL[status] || status;
}
export function programStatusLabel(status: Program['status']): string {
  return PROGRAM_STATUS_LABEL[status] || status;
}
export function mechanismLabel(mechanism: NonNullable<Program['mechanism']>): string {
  return MECHANISM_LABEL[mechanism] || mechanism;
}

/** First sentence of a summary/profile paragraph, whitespace-normalized. */
export function firstSentence(text: string): string {
  const flat = (text || '').trim().replace(/\s+/g, ' ');
  const m = flat.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : flat).trim();
}

export interface CoFunder {
  org: Org;
  sharedGrantees: number;
}

/** Orgs that funded at least one of the same grantees as `orgId`, ranked by overlap. */
export function coFundersOf(orgId: string, index: RegistryIndex, limit = 6): CoFunder[] {
  const myGrantees = new Set(index.awards.filter((a) => a.funder === orgId).map((a) => a.grantee));
  if (myGrantees.size === 0) return [];
  const counts = new Map<string, number>();
  for (const a of index.awards) {
    if (a.funder === orgId || !myGrantees.has(a.grantee)) continue;
    counts.set(a.funder, (counts.get(a.funder) || 0) + 1);
  }
  const orgsById = new Map(index.orgs.map((o) => [o.id, o]));
  return [...counts.entries()]
    .map(([id, sharedGrantees]) => ({ org: orgsById.get(id), sharedGrantees }))
    .filter((c): c is { org: Org; sharedGrantees: number } => !!c.org)
    .sort((a, b) => b.sharedGrantees - a.sharedGrantees || a.org.name.localeCompare(b.org.name))
    .slice(0, limit);
}

/** Awards sorted newest-first (unset dates sink to the bottom). */
export function byDateDesc(awards: Award[]): Award[] {
  return [...awards].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
