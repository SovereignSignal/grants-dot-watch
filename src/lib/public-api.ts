// Public query surface over the register. Same files the site reads.
// Nothing private: explicit field picks, no Desk or BD keys.
import { collapseStandingDepartures, collectCurrentDepartures } from './departures';
import { paginate, parsePage } from './pagination';
import { loadRegistry } from './registry';
import { currentRounds, productDateISO } from './round-state';
import type { Award, Org, Program, RegistryIndex, System, Wire } from './types';

export const API_VERSION = 'v1';
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
export const COLLECTION_KINDS = ['systems', 'orgs', 'programs', 'awards'] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

const WIRES = new Set<Wire>(['crypto', 'ai', 'oss']);

export function isCollectionKind(value: string): value is CollectionKind {
  return (COLLECTION_KINDS as readonly string[]).includes(value);
}

export function parseLimit(value: string | null | undefined): number {
  if (!value || !/^\d+$/.test(value)) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
  };
}

export function apiJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders() });
}

export function apiError(status: number, error: string, message: string): Response {
  return apiJson({ error, message }, status);
}

function firstParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value || undefined;
}

function asWire(value: string | undefined): Wire | undefined {
  if (!value) return undefined;
  return WIRES.has(value as Wire) ? (value as Wire) : undefined;
}

function matchesQuery(haystacks: Array<string | null | undefined>, needle: string): boolean {
  const q = needle.toLowerCase();
  return haystacks.some((value) => (value || '').toLowerCase().includes(q));
}

export function publicSystem(system: System) {
  return {
    id: system.id,
    name: system.name,
    kind: system.kind,
    part_of: system.part_of || [],
    wires: system.wires || [],
    summary: system.summary,
    funding_channels: system.funding_channels || [],
    sources: system.sources || [],
    href: `/systems/${system.id}`,
    api: `/api/v1/systems/${system.id}`,
  };
}

export function publicOrg(org: Org, registry?: RegistryIndex) {
  const stats = registry?.orgStats.get(org.id);
  return {
    id: org.id,
    name: org.name,
    aka: org.aka || [],
    systems: org.systems || [],
    wires: org.wires || [],
    roles: org.roles || [],
    org_type: org.org_type || null,
    website: org.website || null,
    socials: org.socials || {},
    status: org.status,
    profile: org.profile,
    funding: org.funding || null,
    sources: org.sources || [],
    activity: stats
      ? {
          live_rounds: stats.live_rounds,
          programs: stats.programs,
          awards_given: stats.awards_given,
          last_activity: stats.last_activity,
        }
      : null,
    href: `/orgs/${org.id}`,
    api: `/api/v1/orgs/${org.id}`,
  };
}

export function publicProgram(program: Program, today: string = productDateISO()) {
  const live = currentRounds(program, today);
  return {
    id: program.id,
    name: program.name,
    org: program.org,
    parent: program.parent || null,
    ...(program.parent_round ? { parent_round: program.parent_round } : {}),
    systems: program.systems || [],
    wires: program.wires || [],
    status: program.status,
    mechanism: program.mechanism || null,
    apply_url: program.apply_url || null,
    summary: program.summary,
    rounds: program.rounds || [],
    sources: program.sources || [],
    live: live.length > 0,
    live_rounds: live,
    href: `/programs/${program.id}`,
    api: `/api/v1/programs/${program.id}`,
  };
}

export function publicAward(award: Award) {
  return {
    key: award.key,
    funder: award.funder,
    funder_name: award.funder_name,
    grantee: award.grantee,
    grantee_name: award.grantee_name,
    amount: award.amount,
    currency: award.currency,
    amount_text: award.amount_text,
    date: award.date,
    program: award.program,
    program_name: award.program_name,
    wire: award.wire,
    source: award.source,
    hrefs: {
      funder: `/orgs/${award.funder}`,
      program: award.program ? `/programs/${award.program}` : null,
    },
  };
}

export function liveBoard(registry: RegistryIndex = loadRegistry(), today: string = productDateISO()) {
  const departures = collapseStandingDepartures(collectCurrentDepartures(registry.programs, registry.orgs, today));
  return departures.map((row) => ({
    program_id: row.program.id,
    program_name: row.program.name,
    org: row.program.org,
    org_name: row.orgName,
    wires: row.program.wires || [],
    apply_url: row.program.apply_url || null,
    standing: !row.round.closes,
    round: {
      name: row.round.name,
      status: row.round.status,
      opens: row.round.opens || null,
      closes: row.round.closes || null,
      size: row.round.size || null,
      source: row.round.source || null,
    },
    href: `/programs/${row.program.id}`,
    api: `/api/v1/programs/${row.program.id}`,
  }));
}

export function liveCounts(registry: RegistryIndex = loadRegistry(), today: string = productDateISO()) {
  const board = liveBoard(registry, today);
  const dated = board.filter((row) => !row.standing);
  const standing = board.filter((row) => row.standing);
  const byWire = (wire: Wire) => board.filter((row) => row.wires.includes(wire)).length;
  return {
    dated: dated.length,
    standing: standing.length,
    total: board.length,
    crypto: byWire('crypto'),
    ai: byWire('ai'),
    oss: byWire('oss'),
  };
}

export type LiveBoardRow = ReturnType<typeof liveBoard>[number];

/** True when the apply URL is the funder's own homepage, not a form. */
export function isOrgHomepageApply(
  applyUrl: string | null | undefined,
  orgWebsite: string | null | undefined
): boolean {
  if (!applyUrl || !orgWebsite) return false;
  try {
    const apply = new URL(applyUrl);
    const site = new URL(orgWebsite);
    const host = (value: string) => value.replace(/^www\./, '');
    if (host(apply.host) !== host(site.host)) return false;
    const path = (value: string) => value.replace(/\/$/, '') || '/';
    return path(apply.pathname) === '/';
  } catch {
    return false;
  }
}

/** Same live board as GET /api/v1/open, split for a person to read. */
export function briefingBoard(options: {
  wire?: Wire;
  registry?: RegistryIndex;
  today?: string;
} = {}) {
  const registry = options.registry ?? loadRegistry();
  const today = options.today ?? productDateISO();
  const wire = options.wire;
  let rows = liveBoard(registry, today);
  if (wire) rows = rows.filter((row) => row.wires.includes(wire));
  const dated = rows.filter((row) => !row.standing);
  const standing = rows.filter((row) => row.standing);
  return {
    as_of: today,
    dated,
    standingOpen: standing.filter((row) => row.round.status === 'open'),
    standingAnnounced: standing.filter((row) => row.round.status !== 'open'),
    total: rows.length,
  };
}

function listMeta(registry: RegistryIndex, page: ReturnType<typeof paginate>, today: string) {
  return {
    as_of: today,
    updated_at: registry.updatedAt,
    total: page.total,
    page: page.page,
    limit: page.pageSize,
    next_page: page.page < page.totalPages ? page.page + 1 : null,
  };
}

export function filterSystems(systems: System[], params: URLSearchParams): System[] {
  const wire = asWire(firstParam(params, 'wire'));
  const q = firstParam(params, 'q');
  let list = systems;
  if (wire) list = list.filter((system) => (system.wires || []).includes(wire));
  if (q) list = list.filter((system) => matchesQuery([system.id, system.name, system.summary], q));
  return list;
}

export function filterOrgs(orgs: Org[], params: URLSearchParams): Org[] {
  const wire = asWire(firstParam(params, 'wire'));
  const system = firstParam(params, 'system');
  const status = firstParam(params, 'status');
  const role = firstParam(params, 'role');
  const q = firstParam(params, 'q');
  let list = orgs;
  if (wire) list = list.filter((org) => (org.wires || []).includes(wire));
  if (system) list = list.filter((org) => (org.systems || []).includes(system));
  if (status) list = list.filter((org) => org.status === status);
  if (role) list = list.filter((org) => (org.roles || []).includes(role as Org['roles'][number]));
  if (q) list = list.filter((org) => matchesQuery([org.id, org.name, ...(org.aka || []), org.profile], q));
  return list;
}

export function filterPrograms(programs: Program[], params: URLSearchParams, today: string = productDateISO()): Program[] {
  const wire = asWire(firstParam(params, 'wire'));
  const system = firstParam(params, 'system');
  const status = firstParam(params, 'status');
  const mechanism = firstParam(params, 'mechanism');
  const org = firstParam(params, 'org');
  const live = firstParam(params, 'live');
  const q = firstParam(params, 'q');
  let list = programs;
  if (wire) list = list.filter((program) => (program.wires || []).includes(wire));
  if (system) list = list.filter((program) => (program.systems || []).includes(system));
  if (status) list = list.filter((program) => program.status === status);
  if (mechanism) list = list.filter((program) => (program.mechanism || 'other') === mechanism);
  if (org) list = list.filter((program) => program.org === org);
  if (live === '1' || live === 'true') list = list.filter((program) => currentRounds(program, today).length > 0);
  if (q) list = list.filter((program) => matchesQuery([program.id, program.name, program.summary, program.org], q));
  return list;
}

export function filterAwards(awards: Award[], params: URLSearchParams): Award[] {
  const wire = asWire(firstParam(params, 'wire'));
  const funder = firstParam(params, 'funder');
  const grantee = firstParam(params, 'grantee');
  const program = firstParam(params, 'program');
  const year = firstParam(params, 'year');
  const q = firstParam(params, 'q');
  let list = awards;
  if (wire) list = list.filter((award) => award.wire === wire);
  if (funder) list = list.filter((award) => award.funder === funder);
  if (grantee) list = list.filter((award) => award.grantee === grantee);
  if (program) list = list.filter((award) => award.program === program);
  if (year) list = list.filter((award) => (award.date || '').startsWith(year));
  if (q) {
    list = list.filter((award) =>
      matchesQuery(
        [award.funder, award.funder_name, award.grantee, award.grantee_name, award.program, award.program_name, award.key],
        q
      )
    );
  }
  return list;
}

export function queryCollection(kind: CollectionKind, params: URLSearchParams, registry: RegistryIndex = loadRegistry()) {
  const today = productDateISO();
  const limit = parseLimit(params.get('limit'));
  const pageNumber = parsePage(params.get('page') || undefined);

  if (kind === 'systems') {
    const items = filterSystems(registry.systems, params).map((system) => publicSystem(system));
    const page = paginate(items, pageNumber, limit);
    return { data: page.items, meta: listMeta(registry, page, today) };
  }
  if (kind === 'orgs') {
    const items = filterOrgs(registry.orgs, params).map((org) => publicOrg(org, registry));
    const page = paginate(items, pageNumber, limit);
    return { data: page.items, meta: listMeta(registry, page, today) };
  }
  if (kind === 'programs') {
    const items = filterPrograms(registry.programs, params, today).map((program) => publicProgram(program, today));
    const page = paginate(items, pageNumber, limit);
    return { data: page.items, meta: listMeta(registry, page, today) };
  }

  const items = filterAwards(registry.awards, params).map((award) => publicAward(award));
  const page = paginate(items, pageNumber, limit);
  return { data: page.items, meta: listMeta(registry, page, today) };
}

export function queryOpen(params: URLSearchParams, registry: RegistryIndex = loadRegistry()) {
  const today = productDateISO();
  const wire = asWire(firstParam(params, 'wire'));
  const standing = firstParam(params, 'standing');
  let board = liveBoard(registry, today);
  if (wire) board = board.filter((row) => row.wires.includes(wire));
  if (standing === '1' || standing === 'true') board = board.filter((row) => row.standing);
  if (standing === '0' || standing === 'false') board = board.filter((row) => !row.standing);
  const limit = parseLimit(params.get('limit'));
  const page = paginate(board, parsePage(params.get('page') || undefined), limit);
  return { data: page.items, meta: listMeta(registry, page, today) };
}

export function getRecord(kind: CollectionKind, id: string, registry: RegistryIndex = loadRegistry()) {
  const today = productDateISO();
  if (kind === 'systems') {
    const system = registry.systems.find((row) => row.id === id);
    return system ? publicSystem(system) : null;
  }
  if (kind === 'orgs') {
    const org = registry.orgs.find((row) => row.id === id);
    return org ? publicOrg(org, registry) : null;
  }
  if (kind === 'programs') {
    const program = registry.programs.find((row) => row.id === id);
    return program ? publicProgram(program, today) : null;
  }
  const award = registry.awards.find((row) => row.key === id);
  return award ? publicAward(award) : null;
}

export function apiIndex(registry: RegistryIndex = loadRegistry()) {
  const today = productDateISO();
  const live = liveCounts(registry, today);
  return {
    name: 'grants.watch',
    version: API_VERSION,
    as_of: today,
    updated_at: registry.updatedAt,
    counts: registry.counts,
    live,
    endpoints: {
      index: '/api/v1',
      open: '/api/v1/open',
      systems: '/api/v1/systems',
      system: '/api/v1/systems/{id}',
      orgs: '/api/v1/orgs',
      org: '/api/v1/orgs/{id}',
      programs: '/api/v1/programs',
      program: '/api/v1/programs/{id}',
      awards: '/api/v1/awards',
      updates: '/api/v1/updates',
      update: '/api/v1/updates/{numeric_wire_id}',
    },
    filters: {
      shared: ['wire', 'q', 'page', 'limit'],
      orgs: ['system', 'status', 'role'],
      programs: ['system', 'status', 'mechanism', 'org', 'live=1'],
      awards: ['funder', 'grantee', 'program', 'year'],
      open: ['standing=1', 'standing=0'],
    },
    update_access: {
      authentication: 'Bearer token required for updates only; existing registry endpoints remain public.',
      pagination: 'Full scan using after_id and through_id; restart at the first page on each poll.',
      limits: '100 rows per page; 60 authenticated requests per minute per client per process.',
      meaning: 'Reviewed observations. Check primary sources before publishing; approval is not verification of current availability.',
    },
  };
}
