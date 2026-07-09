// Builds the relational galaxy graph from the registry: funder orgs +
// grantees as nodes, funder->grantee AWARD edges as the primary structure —
// the point of galaxy v2 (docs/galaxy-3d-direction.md "Graph v2 spec"). Direct
// co-funding overlap is sparse in the ledger (34 pairs even at >=1 shared
// grantee across 230 funders), so the connective web comes from flows:
// funders connect THROUGH the grantees they share, mapofzones-style. System
// membership still adds gravitational anchor links so systems act as hubs.
import { loadRegistry } from './registry';
import type { Wire } from './types';

export interface GalaxyOrgNode {
  id: string; // org slug — matches /orgs/[id]
  kind: 'org';
  name: string;
  wire: Wire | null; // first wire, drives color
  systems: string[];
  size: number;
  live: boolean; // has an open/announced round right now
  awards: number; // awards given
  totalUsd: number; // sum of USD-known awards given
}

export interface GalaxySystemNode {
  id: string; // `sys:<system-id>`
  kind: 'system';
  name: string;
  size: number;
  memberCount: number; // funder orgs anchored to this system
}

export interface GalaxyGranteeNode {
  id: string; // `g:<grantee-slug>` — slug matches /grantees/[slug]
  kind: 'grantee';
  slug: string; // bare grantee slug, for routing
  name: string;
  funders: number; // distinct funder count
  totalUsd: number; // sum of USD-known awards received
  orgId: string | null; // set when a curated org file exists — routes to /orgs/[id] instead
  size: number;
}

export type GalaxyNode = GalaxyOrgNode | GalaxySystemNode | GalaxyGranteeNode;

export interface GalaxyLink {
  source: string;
  target: string;
  weight: number;
  kind: 'cofunding' | 'system' | 'award';
}

export interface GalaxyGraph {
  nodes: GalaxyNode[];
  links: GalaxyLink[];
}

const COFUNDING_MIN_SHARED = 1; // >=1 shared grantee — at 2 the web collapsed to 15 links across 230 funders // must share at least this many grantees to link
const COFUNDING_CAP = 900; // strongest links kept, before the no-orphan backfill
const SINGLE_FUNDER_GRANTEE_CAP = 150; // top single-funder grantees kept, ranked by known USD

export function buildGalaxyGraph(): GalaxyGraph {
  const { orgs, orgStats, grantees, systems } = loadRegistry();

  const funders = orgs.filter((o) => (o.roles || []).includes('funder'));
  const funderIds = new Set(funders.map((o) => o.id));

  const orgNodes: GalaxyOrgNode[] = funders.map((o) => {
    const st = orgStats.get(o.id);
    const weight = (st?.awards_given || 0) + (st?.programs || 0) * 2 + (st?.live_rounds || 0) * 3;
    return {
      id: o.id,
      kind: 'org',
      name: o.name,
      wire: (o.wires || [])[0] || null,
      systems: o.systems || [],
      size: 1 + Math.log2(1 + weight),
      live: (st?.live_rounds || 0) > 0,
      awards: st?.awards_given || 0,
      totalUsd: st?.awards_total_usd || 0,
    };
  });

  // ---- grantee selection: all multi-funder grantees (the bridges) + the
  // top single-funder grantees by known USD (docs/galaxy-3d-direction.md:
  // "66 multi-funder grantees ... + top ~150 single-funder grantees") ----
  // `grantees` funders lists are not pre-filtered to registered funder orgs,
  // so recompute in-scope funder counts per grantee before splitting.
  const granteesInScope = grantees
    .map((g) => ({ g, scopedFunders: g.funders.filter((f) => funderIds.has(f)) }))
    .filter((x) => x.scopedFunders.length > 0);

  const multiFunder = granteesInScope.filter((x) => x.scopedFunders.length >= 2);
  const singleFunder = granteesInScope
    .filter((x) => x.scopedFunders.length === 1)
    .sort((a, b) => b.g.total_known - a.g.total_known)
    .slice(0, SINGLE_FUNDER_GRANTEE_CAP);

  const includedGrantees = [...multiFunder, ...singleFunder];

  const granteeNodes: GalaxyGranteeNode[] = includedGrantees.map(({ g, scopedFunders }) => ({
    id: `g:${g.slug}`,
    kind: 'grantee',
    slug: g.slug,
    name: g.name,
    funders: scopedFunders.length,
    totalUsd: g.total_known,
    orgId: g.org_id || null,
    size: scopedFunders.length >= 2 ? 1.4 + Math.sqrt(scopedFunders.length) * 0.9 : 0.9,
  }));

  // ---- award links: funder -> grantee, for every included grantee ----
  const awardLinks: GalaxyLink[] = [];
  for (const { g, scopedFunders } of includedGrantees) {
    const countByFunder = new Map<string, number>();
    for (const a of g.awards) {
      if (!funderIds.has(a.funder)) continue;
      countByFunder.set(a.funder, (countByFunder.get(a.funder) || 0) + 1);
    }
    for (const f of scopedFunders) {
      awardLinks.push({ source: f, target: `g:${g.slug}`, weight: countByFunder.get(f) || 1, kind: 'award' });
    }
  }

  // ---- co-funding links: pairs of funders sharing >= COFUNDING_MIN_SHARED
  // grantees. Kept as brighter accent links on top of the award structure
  // above (docs/galaxy-3d-direction.md: "the 34 co-funding accent links"). ----
  const pairCounts = new Map<string, number>(); // "a|b" (a<b) -> shared grantee count
  const bestPartner = new Map<string, { partner: string; weight: number }>();

  const bump = (a: string, b: string) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  };

  for (const g of grantees) {
    const fs = g.funders.filter((f) => funderIds.has(f));
    if (fs.length < 2) continue;
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) bump(fs[i], fs[j]);
    }
  }

  const cofundingAll: GalaxyLink[] = [];
  for (const [key, weight] of pairCounts) {
    if (weight < COFUNDING_MIN_SHARED) continue;
    const [source, target] = key.split('|');
    cofundingAll.push({ source, target, weight, kind: 'cofunding' });

    const bs = bestPartner.get(source);
    if (!bs || weight > bs.weight) bestPartner.set(source, { partner: target, weight });
    const bt = bestPartner.get(target);
    if (!bt || weight > bt.weight) bestPartner.set(target, { partner: source, weight });
  }
  cofundingAll.sort((a, b) => b.weight - a.weight);

  const cofunding = cofundingAll.slice(0, COFUNDING_CAP);
  const connected = new Set<string>();
  for (const l of cofunding) {
    connected.add(l.source);
    connected.add(l.target);
  }
  // no-orphan backfill: any funder with a qualifying co-funding relationship
  // keeps at least its single strongest link, even if capping dropped it.
  for (const [orgId, best] of bestPartner) {
    if (connected.has(orgId)) continue;
    cofunding.push({ source: orgId, target: best.partner, weight: best.weight, kind: 'cofunding' });
    connected.add(orgId);
    connected.add(best.partner);
  }

  // ---- system-anchor links: every org->system membership; systems as hubs ----
  const systemMemberCount = new Map<string, number>();
  const systemLinks: GalaxyLink[] = [];
  for (const o of orgNodes) {
    for (const sysId of o.systems) {
      systemLinks.push({ source: o.id, target: `sys:${sysId}`, weight: 1, kind: 'system' });
      systemMemberCount.set(sysId, (systemMemberCount.get(sysId) || 0) + 1);
    }
  }

  const systemNodes: GalaxySystemNode[] = systems
    .filter((s) => systemMemberCount.has(s.id))
    .map((s) => {
      const n = systemMemberCount.get(s.id) || 0;
      return {
        id: `sys:${s.id}`,
        kind: 'system',
        name: s.name,
        size: 3 + Math.sqrt(n) * 1.5,
        memberCount: n,
      };
    });

  return {
    nodes: [...orgNodes, ...granteeNodes, ...systemNodes],
    links: [...awardLinks, ...cofunding, ...systemLinks],
  };
}
