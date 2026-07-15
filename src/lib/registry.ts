// Loads registry/ (YAML + JSONL files — the canonical dataset) into an in-memory
// index. Files are the truth; this index is disposable and rebuilt on demand.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import type { Award, Grantee, Org, OrgStats, Program, RegistryIndex, System } from './types';

const ROOT = join(process.cwd(), 'registry');

let cache: RegistryIndex | null = null;

/** Reads path, size, and mtime for every registry source on a cold load. The
 *  newest source mtime drives the public update date. A missing dir or stat
 *  race degrades to an empty entry rather than taking down the site. */
function newestFileMtime(dir: string, ext: string): number {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(ext)).sort();
  } catch {
    return 0;
  }
  let newestMtimeMs = 0;
  for (const f of files) {
    try {
      newestMtimeMs = Math.max(newestMtimeMs, statSync(join(dir, f)).mtimeMs);
    } catch {
      // A file can disappear between readdir and stat during a Desk write.
    }
  }
  return newestMtimeMs;
}

function registryUpdatedAt(): string {
  const newestMtimeMs = Math.max(
    newestFileMtime(join(ROOT, 'systems'), '.yaml'),
    newestFileMtime(join(ROOT, 'orgs'), '.yaml'),
    newestFileMtime(join(ROOT, 'programs'), '.yaml'),
    newestFileMtime(join(ROOT, 'awards'), '.jsonl')
  );
  return new Date(newestMtimeMs || Date.now()).toISOString();
}

/** Force the next loadRegistry() call to re-read from disk. Call after any
 *  write to registry files. */
export function invalidateRegistryCache(): void {
  cache = null;
}

function loadYamlDir<T>(sub: string): T[] {
  const dir = join(ROOT, sub);
  if (!existsSync(dir)) return [];
  const out: T[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    try {
      const doc = YAML.parse(readFileSync(join(dir, f), 'utf8'));
      if (doc && typeof doc === 'object') out.push(doc as T);
    } catch {
      // a broken file never takes the site down; validator catches it in CI
    }
  }
  return out;
}

function loadAwards(): Award[] {
  const dir = join(ROOT, 'awards');
  if (!existsSync(dir)) return [];
  const out: Award[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* skip bad line */
      }
    }
  }
  return out;
}

export function loadRegistry(force = false): RegistryIndex {
  if (cache && !force) return cache;
  const updatedAt = registryUpdatedAt();

  const systems = loadYamlDir<System>('systems').sort((a, b) => a.name.localeCompare(b.name));
  const orgs = loadYamlDir<Org>('orgs').sort((a, b) => a.name.localeCompare(b.name));
  const programs = loadYamlDir<Program>('programs').sort((a, b) => a.name.localeCompare(b.name));
  const awards = loadAwards();

  const orgIds = new Set(orgs.map((o) => o.id));

  // derived grantees
  const gmap = new Map<string, Grantee>();
  for (const a of awards) {
    if (!a.grantee) continue;
    let g = gmap.get(a.grantee);
    if (!g) {
      g = { slug: a.grantee, name: a.grantee_name || a.grantee, awards: [], funders: [], total_known: 0 };
      gmap.set(a.grantee, g);
    }
    g.awards.push(a);
    if (!g.funders.includes(a.funder)) g.funders.push(a.funder);
    if (a.amount && (!a.currency || a.currency.toUpperCase() === 'USD')) g.total_known += a.amount;
    if (orgIds.has(a.grantee)) g.org_id = a.grantee;
  }
  const grantees = [...gmap.values()].sort((a, b) => b.funders.length - a.funders.length || b.awards.length - a.awards.length);

  // per-org stats
  const orgStats = new Map<string, OrgStats>();
  const progByOrg = new Map<string, Program[]>();
  for (const p of programs) {
    if (!progByOrg.has(p.org)) progByOrg.set(p.org, []);
    progByOrg.get(p.org)!.push(p);
  }
  for (const o of orgs) {
    const given = awards.filter((a) => a.funder === o.id);
    const progs = progByOrg.get(o.id) || [];
    const liveRounds = progs.flatMap((p) => p.rounds || []).filter((r) => r.status === 'open' || r.status === 'announced');
    const dates = [
      ...given.map((a) => a.date).filter(Boolean),
      ...progs.flatMap((p) => (p.rounds || []).map((r) => r.closes || r.opens)).filter(Boolean),
    ] as string[];
    orgStats.set(o.id, {
      awards_given: given.length,
      awards_total_usd: given.reduce((n, a) => n + (a.amount && (!a.currency || a.currency.toUpperCase() === 'USD') ? a.amount : 0), 0),
      grantees: new Set(given.map((a) => a.grantee)).size,
      programs: progs.length,
      live_rounds: liveRounds.length,
      last_activity: dates.sort().pop() || null,
    });
  }

  // per-system groupings
  const bySystem = new Map<string, { orgs: Org[]; programs: Program[] }>();
  for (const s of systems) bySystem.set(s.id, { orgs: [], programs: [] });
  for (const o of orgs) for (const s of o.systems || []) bySystem.get(s)?.orgs.push(o);
  for (const p of programs) for (const s of p.systems || []) bySystem.get(s)?.programs.push(p);

  cache = {
    systems,
    orgs,
    programs,
    awards,
    grantees,
    orgStats,
    bySystem,
    loadedAt: new Date().toISOString(),
    updatedAt,
    counts: {
      systems: systems.length,
      orgs: orgs.length,
      funders: orgs.filter((o) => o.roles?.includes('funder')).length,
      programs: programs.length,
      awards: awards.length,
      grantees: grantees.length,
    },
  };
  return cache;
}

export const getSystem = (id: string) => loadRegistry().systems.find((s) => s.id === id) || null;
export const getOrg = (id: string) => loadRegistry().orgs.find((o) => o.id === id) || null;
export const getProgram = (id: string) => loadRegistry().programs.find((p) => p.id === id) || null;
export const getGrantee = (slug: string) => loadRegistry().grantees.find((g) => g.slug === slug) || null;
export const programsOf = (orgId: string) => loadRegistry().programs.filter((p) => p.org === orgId);
export const awardsGivenBy = (orgId: string) => loadRegistry().awards.filter((a) => a.funder === orgId);
export const awardsReceivedBy = (slug: string) => loadRegistry().awards.filter((a) => a.grantee === slug);
