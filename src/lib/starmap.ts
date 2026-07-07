// Deterministic star layout for the field (home hero) and the galaxy view.
// Every star is a real org; every cluster a real system. Positions are
// hash-seeded — stable across renders and server/client, no randomness.
import type { Org, OrgStats, System, Wire } from './types';

export interface Star {
  org: string; // org id
  name: string;
  x: number; // 0..1 layout space
  y: number;
  r: number; // radius in px at scale 1
  wire: Wire | null;
  system: string | null; // primary system id
  systems: string[];
  live: boolean; // has open/announced rounds
  funder: boolean;
}

export interface GalaxyCluster {
  system: string;
  name: string;
  kind: System['kind'];
  x: number;
  y: number;
  r: number; // cluster radius in layout space
  members: number;
}

export interface Starmap {
  clusters: GalaxyCluster[];
  stars: Star[];
}

// FNV-1a — cheap, stable
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const unit = (h: number) => (h % 100000) / 100000;

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function buildStarmap(
  systems: System[],
  orgs: Org[],
  stats: Map<string, OrgStats>
): Starmap {
  // biggest systems near the center, spiraling outward
  const bySize = systems
    .map((s) => ({ s, n: orgs.filter((o) => (o.systems || [])[0] === s.id).length }))
    .sort((a, b) => b.n - a.n);

  const clusters: GalaxyCluster[] = bySize.map(({ s, n }, i) => {
    const rad = 0.07 + 0.055 * Math.sqrt(n + 1);
    const dist = 0.09 * Math.sqrt(i + 0.6);
    const ang = i * GOLDEN + unit(hash(s.id)) * 0.5;
    return {
      system: s.id,
      name: s.name,
      kind: s.kind,
      x: 0.5 + Math.cos(ang) * dist * 0.92,
      y: 0.5 + Math.sin(ang) * dist * 0.62, // squash to widescreen
      r: rad,
      members: n,
    };
  });
  const cmap = new Map(clusters.map((c) => [c.system, c]));

  const stars: Star[] = orgs.map((o) => {
    const st = stats.get(o.id);
    const weight =
      (st?.awards_given || 0) + (st?.programs || 0) * 2 + (st?.live_rounds || 0) * 3;
    const r = 1.6 + Math.min(6.5, Math.log2(1 + weight) * 1.35);
    const primary = (o.systems || [])[0] || null;
    const c = primary ? cmap.get(primary) : undefined;
    const h1 = hash(o.id);
    const h2 = hash(o.id + '·');
    let x: number, y: number;
    if (c) {
      // inside the cluster disc, denser toward the core
      const ang = unit(h1) * Math.PI * 2;
      const rr = Math.sqrt(unit(h2)) * c.r * 0.9;
      x = c.x + Math.cos(ang) * rr;
      y = c.y + Math.sin(ang) * rr * 0.75;
    } else {
      // field stars: the unaffiliated drift at the edges
      const ang = unit(h1) * Math.PI * 2;
      const rr = 0.38 + unit(h2) * 0.13;
      x = 0.5 + Math.cos(ang) * rr;
      y = 0.5 + Math.sin(ang) * rr * 0.66;
    }
    return {
      org: o.id,
      name: o.name,
      x: Math.min(0.985, Math.max(0.015, x)),
      y: Math.min(0.97, Math.max(0.03, y)),
      r,
      wire: (o.wires || [])[0] || null,
      system: primary,
      systems: o.systems || [],
      live: (st?.live_rounds || 0) > 0,
      funder: (o.roles || []).includes('funder'),
    };
  });

  return { clusters, stars };
}

export const WIRE_HEX: Record<string, string> = {
  crypto: '#bc7e1e',
  ai: '#9b7bf7',
  oss: '#1fa3b5',
};
export const STAR_DEFAULT = '#8f93a8';
