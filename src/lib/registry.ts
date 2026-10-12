// Loads registry/ (YAML + JSONL files — the canonical dataset) into an in-memory
// index. Files are the truth; this index is disposable and rebuilt on demand.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import type { Award, Grantee, Org, OrgStats, Program, RegistryIndex, System } from './types';
import { currentRounds, productDateISO } from './round-state';
import { dateBounds } from './opportunities';

const ROOT = join(process.cwd(), 'registry');

let cache: RegistryIndex | null = null;
let cacheDateISO: string | null = null;
let cacheSignature = '';
let cacheCheckedMs = 0;

/** How stale a registry write made OUTSIDE this process may be before a request
 *  sees it. Writes made in this process invalidate explicitly and are visible at
 *  once (committer.ts, validation-runner.ts, api/desk/decide-bulk); this bound
 *  exists for the writers that cannot reach that function — boot-replay.ts, a
 *  separate sync-desk-commits.mjs run, a git pull, a hand edit — all of which
 *  were invisible for up to a whole Pacific day. Measured on this dataset (933
 *  files): a call that crosses a boundary costs 2.8ms mean / 3.5ms p99 steady,
 *  ~11ms after an idle gap, and is paid at most once per window per process —
 *  so at 5s it is under 0.1% of one core, and the other calls in that window
 *  pay 18us. Lower it only with that walk cost in hand, since it is a per-window
 *  floor on latency. REGISTRY_CACHE_TTL_MS is a test seam, not an
 *  operator knob: it exists so a test can cross a boundary without sleeping 5s,
 *  and it is clamped so a stray value can neither stat-storm nor pin the cache. */
const CACHE_TTL_MS = Math.min(Math.max(Number(process.env.REGISTRY_CACHE_TTL_MS) || 5_000, 250), 60_000);

/** Reads count, total size, and newest mtime for one registry source directory.
 *  Size and count ride along free — statSync already returned them — and they
 *  are what make the signature strictly better than a newest-mtime compare:
 *  verified on this volume, a rewrite that restores the old mtime (a restore, an
 *  archive extract, rsync --times) moves neither the directory mtime nor the
 *  max, but does move `bytes`. A missing dir or a stat race degrades to an empty
 *  entry rather than taking down the site. */
function scanDir(dir: string, ext: string): { count: number; newest: number; bytes: number } {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(ext));
  } catch {
    return { count: 0, newest: 0, bytes: 0 };
  }
  let count = 0;
  let newest = 0;
  let bytes = 0;
  for (const f of files) {
    try {
      const s = statSync(join(dir, f));
      count += 1;
      bytes += s.size;
      if (s.mtimeMs > newest) newest = s.mtimeMs;
    } catch {
      // A file can disappear between readdir and stat during a Desk write.
    }
  }
  return { count, newest, bytes };
}

/** One walk over all 933 registry sources, producing both the staleness
 *  signature and the newest mtime behind the public load date, so the boundary
 *  check and the rebuild never walk twice. Four DIRECTORY mtimes would cost
 *  4.3us instead of 1.95ms, but a same-inode rewrite leaves a directory mtime
 *  untouched — verified on this volume — so that probe would pin the cache
 *  forever behind a future in-place writer, which is strictly worse than the day
 *  this replaces. Every writer here happens to tmp+rename today; that is luck,
 *  not a contract. Returning 0 for an empty registry rather than Date.now()
 *  matters: it must compare equal to itself instead of flapping every check. */
function registryScan(): { signature: string; newestMtimeMs: number } {
  const dirs = [
    scanDir(join(ROOT, 'systems'), '.yaml'),
    scanDir(join(ROOT, 'orgs'), '.yaml'),
    scanDir(join(ROOT, 'programs'), '.yaml'),
    scanDir(join(ROOT, 'awards'), '.jsonl'),
  ];
  return {
    signature: dirs.map((d) => `${d.count}:${d.newest}:${d.bytes}`).join('|'),
    newestMtimeMs: dirs.reduce((newest, d) => Math.max(newest, d.newest), 0),
  };
}

/** Force the next loadRegistry() call to re-read from disk. Call after any
 *  write to registry files. This stays the fast path for an in-process write:
 *  the TTL below bounds only the writers that cannot reach here. Clearing the
 *  two new fields is belt and braces — `cache = null` already defeats both
 *  guards — so a later reordering does not silently depend on it. */
export function invalidateRegistryCache(): void {
  cache = null;
  cacheDateISO = null;
  cacheSignature = '';
  cacheCheckedMs = 0;
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
  const todayISO = productDateISO();
  // Two independent bounds, and BOTH must hold. The product date is the one this
  // cache has always had and stays its own term on the fast path: orgStats
  // .live_rounds below is built from todayISO, so the index must not outlive the
  // Pacific day whatever the TTL says — that removes any reasoning about a
  // window straddling midnight. The TTL is new and bounds an out-of-process
  // write to seconds instead of a day. Measured per org-page render (four calls,
  // since the helpers below each call this): 0.082ms, unchanged by the added
  // term because Date.now() is free next to productDateISO's 20us.
  if (cache && cacheDateISO === todayISO && Date.now() - cacheCheckedMs < CACHE_TTL_MS && !force) return cache;
  // The boundary. Probe, then refresh the stamp WHETHER OR NOT anything moved,
  // so a quiet registry pays one 2.8ms walk per window rather than one per
  // call, and no boundary triggers the ~141ms rebuild for nothing. The probe is
  // taken BEFORE the reads below, so a write landing mid-rebuild reads newer at
  // the next boundary rather than being swallowed. The rejected design — walking
  // on every call — measured 8.04ms mean / 12.09ms p99 per render, 98x this.
  const scan = registryScan();
  cacheCheckedMs = Date.now();
  if (cache && cacheDateISO === todayISO && scan.signature === cacheSignature && !force) return cache;
  // Same walk, reused: the public load date never costs a second pass.
  const updatedAt = new Date(scan.newestMtimeMs || Date.now()).toISOString();

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
  // Public program counts come from program.status. Review expiry is internal.
  for (const o of orgs) {
    const given = awards.filter((a) => a.funder === o.id);
    const progs = progByOrg.get(o.id) || [];
    const liveRounds = progs.flatMap((program) => currentRounds(program, todayISO));
    const dates = [
      ...given.map((a) => a.date).filter(Boolean),
      ...progs.flatMap((p) => (p.rounds || []).flatMap((r) => [r.opens, r.closes])).filter(Boolean),
    ] as string[];
    orgStats.set(o.id, {
      awards_given: given.length,
      awards_total_usd: given.reduce((n, a) => n + (a.amount && (!a.currency || a.currency.toUpperCase() === 'USD') ? a.amount : 0), 0),
      grantees: new Set(given.map((a) => a.grantee)).size,
      programs: progs.length,
      live_rounds: liveRounds.length,
      // Only completed date bounds can establish past activity. A future
      // deadline must not conceal an already recorded opening or award.
      last_activity: dates.filter(date => {
        const bounds = dateBounds(date);
        return bounds && bounds.last <= todayISO;
      }).sort().pop() || null,
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
  cacheDateISO = todayISO;
  cacheSignature = scan.signature;
  return cache;
}

export const getSystem = (id: string) => loadRegistry().systems.find((s) => s.id === id) || null;
export const getOrg = (id: string) => loadRegistry().orgs.find((o) => o.id === id) || null;
export const getProgram = (id: string) => loadRegistry().programs.find((p) => p.id === id) || null;
export const getGrantee = (slug: string) => loadRegistry().grantees.find((g) => g.slug === slug) || null;
export const programsOf = (orgId: string) => loadRegistry().programs.filter((p) => p.org === orgId);
export const awardsGivenBy = (orgId: string) => loadRegistry().awards.filter((a) => a.funder === orgId);
export const awardsReceivedBy = (slug: string) => loadRegistry().awards.filter((a) => a.grantee === slug);
