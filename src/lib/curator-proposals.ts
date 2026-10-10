// Turns a curator proposal into the same RawMinerProposal shape ingest uses,
// so it lands in the Desk queue through insertIngestProposals. Official
// sources are stored, not fetched: the server does not retrieve caller URLs.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dateBounds, httpUrl } from './evidence-fields';
import { slugify } from './committer';
import type { RawMinerProposal } from './desk-store';
import type { CuratorIdentity } from './curator-auth';
import type { CuratorStamp, Org, Program, ProposalType, Wire } from './types';

const WIRES = new Set<Wire>(['crypto', 'ai', 'oss']);
const ORG_STATUS = new Set(['active', 'winding-down', 'dormant', 'dead', 'unknown']);
const PROGRAM_STATUS = new Set(['active', 'paused', 'concluded', 'announced', 'unknown']);
const ROUND_STATUS = new Set(['announced', 'open', 'reviewing', 'closed', 'deployed']);
const FACTS = new Set(['deadline', 'round_dates', 'status', 'x_handle', 'amount', 'summary', 'identity', 'round_merge', 'round_disposition', 'wire']);
const FACT_LIST = 'deadline, round_dates, status, summary, identity, round_merge, round_disposition, wire, x_handle, or amount';
const BLOCKED_KEYS = new Set(['remove', 'delete', 'action', 'merge', 'drop']);

export interface DirectorySnapshot {
  orgs: Org[];
  programs: Program[];
}

export interface DirectoryHit {
  kind: 'org' | 'program';
  id: string;
  name: string;
  status: string;
  wires: Wire[];
  org: string | null;
  website: string | null;
  summary: string;
}

export interface SourceQuote {
  url: string;
  quote: string;
}

export type ProposalBuild =
  | { ok: true; candidate: RawMinerProposal }
  | { ok: false; status: number; body: { error: string; message: string; matches?: DirectoryHit[] } };

function fail(status: number, error: string, message: string, matches?: DirectoryHit[]): ProposalBuild {
  return { ok: false, status, body: { error, message, ...(matches ? { matches } : {}) } };
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed)) return null;
  return trimmed;
}

export function officialHttpsUrl(value: unknown): string | null {
  const href = httpUrl(value);
  if (!href) return null;
  const url = new URL(href);
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return null;
  if (host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
  return url.href;
}

function day(value: unknown): string | null {
  if (typeof value !== 'string' || value.length !== 10) return null;
  const bounds = dateBounds(value);
  if (!bounds || bounds.first !== value) return null;
  return value;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function containsBlockedKey(value: unknown, depth = 0): boolean {
  if (depth > 6 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsBlockedKey(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => BLOCKED_KEYS.has(key) || containsBlockedKey(child, depth + 1)
  );
}

export function proposalBlocked(proposal: { type: string; proposed_change?: unknown }): boolean {
  return proposal.type === 'merge_orgs' || containsBlockedKey(proposal.proposed_change);
}

function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > 180 ? `${flat.slice(0, 177)}...` : flat;
}

function orgHit(org: Org): DirectoryHit {
  return {
    kind: 'org',
    id: org.id,
    name: org.name,
    status: org.status,
    wires: org.wires || [],
    org: null,
    website: org.website || null,
    summary: clip(org.profile || ''),
  };
}

function programHit(program: Program): DirectoryHit {
  return {
    kind: 'program',
    id: program.id,
    name: program.name,
    status: program.status,
    wires: program.wires || [],
    org: program.org,
    website: null,
    summary: clip(program.summary || ''),
  };
}

export function directoryHits(snapshot: DirectorySnapshot, query: string, kind: 'orgs' | 'programs' | 'all'): DirectoryHit[] {
  const needle = query.toLowerCase();
  const hits: DirectoryHit[] = [];
  if (kind !== 'programs') {
    for (const org of snapshot.orgs) {
      const hay = [org.id, org.name, org.profile, org.website, ...(org.aka || [])].join(' ').toLowerCase();
      if (hay.includes(needle)) hits.push(orgHit(org));
    }
  }
  if (kind !== 'orgs') {
    for (const program of snapshot.programs) {
      const hay = [program.id, program.name, program.summary, program.org].join(' ').toLowerCase();
      if (hay.includes(needle)) hits.push(programHit(program));
    }
  }
  hits.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return hits;
}

function parseSources(value: unknown): SourceQuote[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const sources: SourceQuote[] = [];
  for (const item of value) {
    const source = record(item);
    if (!source) return null;
    const url = officialHttpsUrl(source.url);
    const quote = text(source.quote, 12, 2000);
    if (!url || !quote) return null;
    sources.push({ url, quote });
  }
  return sources;
}

function wireOf(value: unknown): Wire | null | undefined {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !WIRES.has(value as Wire)) return undefined;
  return value as Wire;
}

function findOrg(snapshot: DirectorySnapshot, id: string): Org | undefined {
  return snapshot.orgs.find((org) => org.id === id);
}

function findProgram(snapshot: DirectorySnapshot, id: string): Program | undefined {
  return snapshot.programs.find((program) => program.id === id);
}

function orgDuplicates(snapshot: DirectorySnapshot, slug: string, name: string): DirectoryHit[] {
  const wanted = norm(name);
  return snapshot.orgs
    .filter((org) => org.id === slug || norm(org.name) === wanted || (org.aka || []).some((alias) => norm(alias) === wanted))
    .map(orgHit);
}

function programDuplicates(snapshot: DirectorySnapshot, slug: string, orgId: string, name: string): DirectoryHit[] {
  const wanted = norm(name);
  return snapshot.programs
    .filter((program) => program.id === slug || (program.org === orgId && norm(program.name) === wanted))
    .map(programHit);
}

function stamp(identity: CuratorIdentity, reason: string, sources: SourceQuote[], at: string): CuratorStamp {
  return {
    key_id: identity.id,
    key_name: identity.name,
    reason,
    sources: sources.map((source) => source.url),
    quotes: sources,
    at,
  };
}

function candidate(input: {
  type: ProposalType;
  title: string;
  summary: string;
  org: string | null;
  orgName: string | null;
  program: string | null;
  wire: Wire | null;
  evidence: string;
  change: Record<string, unknown>;
  identity: CuratorIdentity;
  reason: string;
  sources: SourceQuote[];
  at: string;
}): RawMinerProposal {
  return {
    type: input.type,
    org: input.org,
    org_name: input.orgName,
    program: input.program,
    title: input.title,
    summary: input.summary,
    evidence_url: input.evidence,
    proposed_change: input.change,
    wire: input.wire,
    submitted_by: stamp(input.identity, input.reason, input.sources, input.at),
  };
}

export function buildCuratorProposal(
  value: unknown,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string
): ProposalBuild {
  const body = record(value);
  if (!body) return fail(400, 'invalid_request', 'Request body must be an object.');
  if (body.kind === 'merge_orgs' || body.kind === 'delete' || body.kind === 'merge') {
    return fail(403, 'forbidden', 'Merges and deletions are not available on this API.');
  }
  const reason = text(body.reason, 8, 2000);
  const summary = text(body.summary, 8, 4000);
  const sources = parseSources(body.sources);
  const wire = wireOf(body.wire);
  if (!reason) return fail(400, 'invalid_request', 'A written reason of 8 to 2000 characters is required.');
  if (!summary) return fail(400, 'invalid_request', 'A summary of 8 to 4000 characters is required.');
  if (!sources) return fail(400, 'invalid_request', 'At least one official https source with a verbatim quote is required.');
  if (wire === undefined) return fail(400, 'invalid_request', 'wire must be crypto, ai, or oss.');
  const titleOverride = body.title === undefined ? null : text(body.title, 3, 200);
  if (body.title !== undefined && !titleOverride) return fail(400, 'invalid_request', 'title must be 3 to 200 characters.');

  if (body.kind === 'new_org') return buildOrg(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
  if (body.kind === 'new_program') return buildProgram(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
  if (body.kind === 'fact') return buildFact(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
  return fail(400, 'invalid_request', 'kind must be new_org, new_program, or fact.');
}

function buildOrg(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  const name = text(body.name, 2, 120);
  if (!name) return fail(400, 'invalid_request', 'name is required for a new organization.');
  const slug = slugify(name);
  if (!slug) return fail(400, 'invalid_request', 'name does not produce a registry id.');
  const duplicates = orgDuplicates(snapshot, slug, name);
  if (duplicates.length) return fail(409, 'conflict', 'An organization with this id or name is already on file.', duplicates);
  const profile = body.profile === undefined ? summary : text(body.profile, 8, 4000);
  if (!profile) return fail(400, 'invalid_request', 'profile must be 8 to 4000 characters.');
  const website = body.website === undefined ? undefined : officialHttpsUrl(body.website);
  if (body.website !== undefined && !website) return fail(400, 'invalid_request', 'website must be an official https URL.');
  const status = body.status === undefined ? 'unknown' : body.status;
  if (typeof status !== 'string' || !ORG_STATUS.has(status)) return fail(400, 'invalid_request', 'status is not a valid organization status.');
  const payload: Record<string, unknown> = {
    id: slug,
    name,
    wires: wire ? [wire] : [],
    roles: ['funder'],
    status,
    profile,
    sources: sources.map((source) => source.url),
  };
  if (website) payload.website = website;
  return {
    ok: true,
    candidate: candidate({
      type: 'new_org',
      title: titleOverride || `New org: ${name}`,
      summary,
      org: null,
      orgName: name,
      program: null,
      wire,
      evidence: sources[0].url,
      change: { [`orgs/${slug}.yaml`]: payload },
      identity,
      reason,
      sources,
      at,
    }),
  };
}

function buildProgram(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  const orgId = text(body.org_id, 1, 80);
  const programName = text(body.program_name, 2, 160);
  if (!orgId || !findOrg(snapshot, orgId)) return fail(404, 'not_found', 'No organization with that id.');
  if (!programName) return fail(400, 'invalid_request', 'program_name is required for a new program.');
  const slug = slugify(programName);
  if (!slug) return fail(400, 'invalid_request', 'program_name does not produce a registry id.');
  const duplicates = programDuplicates(snapshot, slug, orgId, programName);
  if (duplicates.length) return fail(409, 'conflict', 'A program with this id or name is already on file.', duplicates);
  const applyUrl = body.apply_url === undefined ? undefined : officialHttpsUrl(body.apply_url);
  if (body.apply_url !== undefined && !applyUrl) return fail(400, 'invalid_request', 'apply_url must be an official https URL.');
  const status = body.status === undefined ? 'unknown' : body.status;
  if (typeof status !== 'string' || !PROGRAM_STATUS.has(status)) return fail(400, 'invalid_request', 'status is not a valid program status.');
  const org = findOrg(snapshot, orgId)!;
  const payload: Record<string, unknown> = {
    id: slug,
    name: programName,
    org: orgId,
    wires: wire ? [wire] : org.wires || [],
    status,
    summary,
    sources: sources.map((source) => source.url),
  };
  if (applyUrl) payload.apply_url = applyUrl;
  return {
    ok: true,
    candidate: candidate({
      type: 'new_program',
      title: titleOverride || `${org.name} · ${programName}`,
      summary,
      org: orgId,
      orgName: org.name,
      program: programName,
      wire,
      evidence: sources[0].url,
      change: { [`programs/${slug}.yaml`]: payload },
      identity,
      reason,
      sources,
      at,
    }),
  };
}

function buildFact(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  if (typeof body.fact !== 'string' || !FACTS.has(body.fact)) {
    return fail(400, 'invalid_request', `fact must be ${FACT_LIST}.`);
  }
  if (body.fact === 'x_handle') return buildHandle(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
  if (body.fact === 'status') return buildStatus(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
  if (body.fact === 'summary') return buildSummaryEdit(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
  if (body.fact === 'identity') return buildIdentity(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
  if (body.fact === 'round_merge') return buildRoundMerge(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
  if (body.fact === 'round_disposition') return buildRoundDisposition(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
  if (body.fact === 'wire') return buildWireMove(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
  if (body.fact === 'amount' && body.amount_target === 'award') {
    return buildAward(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
  }
  return buildRoundFact(body, identity, snapshot, at, reason, summary, sources, wire, titleOverride);
}

function requireProgram(snapshot: DirectorySnapshot, value: unknown): Program | ProposalBuild {
  const id = text(value, 1, 80);
  if (!id) return fail(400, 'invalid_request', 'program_id is required.');
  const program = findProgram(snapshot, id);
  if (!program) return fail(404, 'not_found', 'No program with that id.');
  return program;
}

function isProgram(value: Program | ProposalBuild): value is Program {
  return (value as Program).id !== undefined && (value as ProposalBuild).ok === undefined;
}

function buildRoundFact(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  const program = requireProgram(snapshot, body.program_id);
  if (!isProgram(program)) return program;
  const roundName = text(body.round, 1, 120);
  if (!roundName) return fail(400, 'invalid_request', 'round is required.');
  const org = findOrg(snapshot, program.org);
  const round: Record<string, unknown> = { name: roundName, source: sources[0].url };
  let type: ProposalType = 'round_update';
  if (body.fact === 'deadline') {
    const closes = day(body.closes);
    if (!closes) return fail(400, 'invalid_request', 'closes must be a YYYY-MM-DD date.');
    round.closes = closes;
    type = 'deadline_change';
  } else if (body.fact === 'round_dates') {
    const opens = body.opens === undefined ? undefined : day(body.opens);
    const closes = body.closes === undefined ? undefined : day(body.closes);
    if (body.opens !== undefined && !opens) return fail(400, 'invalid_request', 'opens must be a YYYY-MM-DD date.');
    if (body.closes !== undefined && !closes) return fail(400, 'invalid_request', 'closes must be a YYYY-MM-DD date.');
    if (!opens && !closes) return fail(400, 'invalid_request', 'round_dates needs opens, closes, or both.');
    if (opens) round.opens = opens;
    if (closes) round.closes = closes;
  } else if (body.fact === 'amount') {
    if (body.amount_target !== 'round') return fail(400, 'invalid_request', 'amount_target must be round or award.');
    const amount = text(body.amount, 1, 80);
    if (!amount) return fail(400, 'invalid_request', 'amount is required.');
    round.size = amount;
  } else {
    return fail(400, 'invalid_request', `fact must be ${FACT_LIST}.`);
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !ROUND_STATUS.has(body.status)) {
      return fail(400, 'invalid_request', 'status is not a valid round status.');
    }
    round.status = body.status;
  }
  const orgName = org?.name || program.org;
  const detail = body.fact === 'deadline' ? `deadline ${String(round.closes)}` : body.fact === 'amount' ? `amount ${String(round.size)}` : 'round dates';
  return {
    ok: true,
    candidate: candidate({
      type,
      title: titleOverride || `${orgName} · ${program.name}: ${detail}`,
      summary,
      org: program.org,
      orgName,
      program: program.name,
      wire: wire || program.wires?.[0] || null,
      evidence: sources[0].url,
      change: { [`programs/${program.id}.yaml`]: { rounds: [round], sources: sources.map((source) => source.url) } },
      identity,
      reason,
      sources,
      at,
    }),
  };
}

function buildStatus(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  const entity = body.entity === 'org' ? 'org' : body.entity === 'program' ? 'program' : null;
  if (!entity) return fail(400, 'invalid_request', 'entity must be org or program.');
  if (entity === 'org') {
    const orgId = text(body.org_id, 1, 80);
    const org = orgId ? findOrg(snapshot, orgId) : undefined;
    if (!org) return fail(404, 'not_found', 'No organization with that id.');
    if (typeof body.status !== 'string' || !ORG_STATUS.has(body.status)) {
      return fail(400, 'invalid_request', 'status is not a valid organization status.');
    }
    if (summary.length < 60) {
      return fail(400, 'invalid_request', 'summary must be at least 60 characters because a status change writes it onto the organization profile.');
    }
    return {
      ok: true,
      candidate: candidate({
        type: 'status_change',
        title: titleOverride || `${org.name}: status ${body.status}`,
        summary,
        org: org.id,
        orgName: org.name,
        program: null,
        wire: wire || org.wires?.[0] || null,
        evidence: sources[0].url,
        change: {
          [`orgs/${org.id}.yaml`]: {
            status: body.status,
            profile: summary,
            sources: sources.map((source) => source.url),
          },
        },
        identity,
        reason,
        sources,
        at,
      }),
    };
  }
  const program = requireProgram(snapshot, body.program_id);
  if (!isProgram(program)) return program;
  if (typeof body.status !== 'string' || !PROGRAM_STATUS.has(body.status)) {
    return fail(400, 'invalid_request', 'status is not a valid program status.');
  }
  if (summary.length < 40) {
    return fail(400, 'invalid_request', 'summary must be at least 40 characters because a status change writes it onto the program.');
  }
  const org = findOrg(snapshot, program.org);
  return {
    ok: true,
    candidate: candidate({
      type: 'status_change',
      title: titleOverride || `${org?.name || program.org} · ${program.name}: status ${body.status}`,
      summary,
      org: program.org,
      orgName: org?.name || program.org,
      program: program.name,
      wire: wire || program.wires?.[0] || null,
      evidence: sources[0].url,
      change: {
        [`programs/${program.id}.yaml`]: {
          status: body.status,
          summary,
          sources: sources.map((source) => source.url),
        },
      },
      identity,
      reason,
      sources,
      at,
    }),
  };
}

function buildHandle(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  const orgId = text(body.org_id, 1, 80);
  const org = orgId ? findOrg(snapshot, orgId) : undefined;
  if (!org) return fail(404, 'not_found', 'No organization with that id.');
  const raw = text(body.x, 1, 16);
  const handle = raw?.replace(/^@/, '') || '';
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return fail(400, 'invalid_request', 'x must be an X handle.');
  return {
    ok: true,
    candidate: candidate({
      type: 'profile_note',
      title: titleOverride || `${org.name}: X @${handle}`,
      summary,
      org: org.id,
      orgName: org.name,
      program: null,
      wire: wire || org.wires?.[0] || null,
      evidence: sources[0].url,
      change: { [`orgs/${org.id}.yaml`]: { socials: { x: `https://x.com/${handle}` }, sources: sources.map((source) => source.url) } },
      identity,
      reason,
      sources,
      at,
    }),
  };
}

function buildAward(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  const orgId = text(body.org_id, 1, 80);
  const org = orgId ? findOrg(snapshot, orgId) : undefined;
  if (!org) return fail(404, 'not_found', 'No organization with that id.');
  const grantee = text(body.grantee, 2, 120);
  const amount = text(body.amount, 1, 80);
  const dated = day(body.date);
  if (!grantee) return fail(400, 'invalid_request', 'grantee is required for an award.');
  if (!amount) return fail(400, 'invalid_request', 'amount is required.');
  if (!dated) return fail(400, 'invalid_request', 'date must be a YYYY-MM-DD date.');
  if (body.currency !== undefined && (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency))) {
    return fail(400, 'invalid_request', 'currency must be a three-letter code.');
  }
  const program = body.program_id === undefined ? null : requireProgram(snapshot, body.program_id);
  if (program && !isProgram(program)) return program;
  const numeric = /^[0-9]+(?:\.[0-9]+)?$/.test(amount) ? Number(amount) : null;
  const award: Record<string, unknown> = {
    funder: org.id,
    funder_name: org.name,
    grantee_name: grantee,
    amount_text: amount,
    date: dated,
    source: sources[0].url,
    wire: wire || org.wires?.[0] || null,
  };
  if (numeric !== null && Number.isSafeInteger(numeric)) award.amount = numeric;
  if (typeof body.currency === 'string') award.currency = body.currency;
  if (program) {
    award.program = program.id;
    award.program_name = program.name;
  }
  return {
    ok: true,
    candidate: candidate({
      type: 'new_award',
      title: titleOverride || `${org.name}: award to ${grantee}`,
      summary,
      org: org.id,
      orgName: org.name,
      program: program ? program.name : null,
      wire: wire || org.wires?.[0] || null,
      evidence: sources[0].url,
      change: { [`awards/${dated.slice(0, 4)}.jsonl`]: award },
      identity,
      reason,
      sources,
      at,
    }),
  };
}

function namedRound(program: Program, name: string) {
  const key = name.toLowerCase().trim();
  return (program.rounds || []).find((round) => round.name.toLowerCase().trim() === key);
}

function programContentHash(id: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return null;
  const path = join(process.cwd(), 'registry', 'programs', `${id}.yaml`);
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Replace one program's wire list. The file hash is captured so approval
 *  refuses to apply if the program changed after this proposal was queued. */
function buildWireMove(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  if (!wire) return fail(400, 'invalid_request', 'wire is required and must be crypto, ai, or oss.');
  const program = requireProgram(snapshot, body.program_id);
  if (!isProgram(program)) return program;
  const current = program.wires || [];
  if (current.length === 1 && current[0] === wire) {
    return fail(409, 'conflict', `Program is already on the ${wire} wire.`);
  }
  const hash = programContentHash(program.id);
  if (!hash) return fail(404, 'not_found', 'No program file with that id.');
  const org = findOrg(snapshot, program.org);
  const key = `programs/${program.id}.yaml`;
  return {
    ok: true,
    candidate: candidate({
      type: 'profile_note',
      title: titleOverride || `${org?.name || program.org} · ${program.name}: move to the ${wire} wire`,
      summary,
      org: program.org,
      orgName: org?.name || program.org,
      program: program.name,
      wire,
      evidence: sources[0].url,
      change: {
        [key]: { wires: [wire], sources: sources.map((source) => source.url) },
        _expected_content_hashes: { [key]: hash },
      },
      identity,
      reason,
      sources,
      at,
    }),
  };
}

function buildSummaryEdit(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  const program = requireProgram(snapshot, body.program_id);
  if (!isProgram(program)) return program;
  if (summary.length < 40) {
    return fail(400, 'invalid_request', 'summary must be at least 40 characters because it replaces the program summary.');
  }
  const org = findOrg(snapshot, program.org);
  return {
    ok: true,
    candidate: candidate({
      type: 'profile_note',
      title: titleOverride || `${org?.name || program.org} · ${program.name}: summary`,
      summary,
      org: program.org,
      orgName: org?.name || program.org,
      program: program.name,
      wire: wire || program.wires?.[0] || null,
      evidence: sources[0].url,
      change: {
        [`programs/${program.id}.yaml`]: {
          summary,
          sources: sources.map((source) => source.url),
        },
      },
      identity,
      reason,
      sources,
      at,
    }),
  };
}

function buildIdentity(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  const entity = body.entity === 'org' ? 'org' : body.entity === 'program' ? 'program' : null;
  if (!entity) return fail(400, 'invalid_request', 'entity must be org or program.');
  const descriptionMin = entity === 'org' ? 60 : 40;
  const description = body.description === undefined ? null : text(body.description, descriptionMin, 4000);
  if (body.description !== undefined && !description) {
    return fail(
      400,
      'invalid_request',
      entity === 'org'
        ? 'description must be 60 to 4000 characters because it replaces the organization profile.'
        : 'description must be 40 to 4000 characters because it replaces the program summary.'
    );
  }
  const nameMax = entity === 'org' ? 120 : 160;
  const name = body.name === undefined ? null : text(body.name, 2, nameMax);
  if (body.name !== undefined && !name) return fail(400, 'invalid_request', `name must be 2 to ${nameMax} characters.`);
  if (!name && !description) return fail(400, 'invalid_request', 'name or description is required.');
  const urls = sources.map((source) => source.url);
  if (entity === 'org') {
    const orgId = text(body.org_id, 1, 80);
    const org = orgId ? findOrg(snapshot, orgId) : undefined;
    if (!org) return fail(404, 'not_found', 'No organization with that id.');
    if (name) {
      const wanted = norm(name);
      const clashes = snapshot.orgs.filter(
        (item) => item.id !== org.id && (norm(item.name) === wanted || (item.aka || []).some((alias) => norm(alias) === wanted))
      );
      if (clashes.length) return fail(409, 'conflict', 'An organization with this name is already on file.', clashes.map(orgHit));
    }
    const patch: Record<string, unknown> = { sources: urls };
    if (name) patch.name = name;
    if (description) patch.profile = description;
    return {
      ok: true,
      candidate: candidate({
        type: 'profile_note',
        title: titleOverride || `${org.name}: name and description`,
        summary,
        org: org.id,
        orgName: org.name,
        program: null,
        wire: wire || org.wires?.[0] || null,
        evidence: sources[0].url,
        change: { [`orgs/${org.id}.yaml`]: patch },
        identity,
        reason,
        sources,
        at,
      }),
    };
  }
  const program = requireProgram(snapshot, body.program_id);
  if (!isProgram(program)) return program;
  if (name) {
    const wanted = norm(name);
    const clashes = snapshot.programs.filter(
      (item) => item.id !== program.id && item.org === program.org && norm(item.name) === wanted
    );
    if (clashes.length) return fail(409, 'conflict', 'A program with this name is already on file.', clashes.map(programHit));
  }
  const org = findOrg(snapshot, program.org);
  const patch: Record<string, unknown> = { sources: urls };
  if (name) patch.name = name;
  if (description) patch.summary = description;
  return {
    ok: true,
    candidate: candidate({
      type: 'profile_note',
      title: titleOverride || `${org?.name || program.org} · ${program.name}: name and description`,
      summary,
      org: program.org,
      orgName: org?.name || program.org,
      program: program.name,
      wire: wire || program.wires?.[0] || null,
      evidence: sources[0].url,
      change: { [`programs/${program.id}.yaml`]: patch },
      identity,
      reason,
      sources,
      at,
    }),
  };
}

function buildRoundMerge(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  const program = requireProgram(snapshot, body.program_id);
  if (!isProgram(program)) return program;
  const duplicateName = text(body.round, 1, 120);
  const keepName = text(body.into, 1, 120);
  if (!duplicateName) return fail(400, 'invalid_request', 'round is the duplicate round name.');
  if (!keepName) return fail(400, 'invalid_request', 'into is the round that should remain.');
  if (duplicateName.toLowerCase().trim() === keepName.toLowerCase().trim()) {
    return fail(400, 'invalid_request', 'round and into must name different rounds.');
  }
  const duplicate = namedRound(program, duplicateName);
  const keeper = namedRound(program, keepName);
  if (!duplicate) return fail(404, 'not_found', 'No round with that name.');
  if (!keeper) return fail(404, 'not_found', 'No round matches into.');
  const org = findOrg(snapshot, program.org);
  const urls = [...new Set([...sources.map((source) => source.url), duplicate.source, keeper.source].filter((url): url is string => Boolean(url)))];
  return {
    ok: true,
    candidate: candidate({
      type: 'round_update',
      title: titleOverride || `${org?.name || program.org} · ${program.name}: merge round "${duplicate.name}" into "${keeper.name}"`,
      summary,
      org: program.org,
      orgName: org?.name || program.org,
      program: program.name,
      wire: wire || program.wires?.[0] || null,
      evidence: sources[0].url,
      change: {
        [`programs/${program.id}.yaml`]: {
          retire_round: duplicate.name,
          keep_round: keeper.name,
          sources: urls,
        },
      },
      identity,
      reason,
      sources,
      at,
    }),
  };
}

function buildRoundDisposition(
  body: Record<string, unknown>,
  identity: CuratorIdentity,
  snapshot: DirectorySnapshot,
  at: string,
  reason: string,
  summary: string,
  sources: SourceQuote[],
  wire: Wire | null,
  titleOverride: string | null
): ProposalBuild {
  const program = requireProgram(snapshot, body.program_id);
  if (!isProgram(program)) return program;
  const roundName = text(body.round, 1, 120);
  if (!roundName) return fail(400, 'invalid_request', 'round is required.');
  if (body.disposition !== 'withdrawn' && body.disposition !== 'duplicate') {
    return fail(400, 'invalid_request', 'disposition must be withdrawn or duplicate.');
  }
  const round = namedRound(program, roundName);
  if (!round) return fail(404, 'not_found', 'No round with that name.');
  const org = findOrg(snapshot, program.org);
  const urls = [...new Set([...sources.map((source) => source.url), round.source].filter((url): url is string => Boolean(url)))];
  return {
    ok: true,
    candidate: candidate({
      type: 'round_update',
      title: titleOverride || `${org?.name || program.org} · ${program.name}: mark "${round.name}" ${body.disposition}`,
      summary,
      org: program.org,
      orgName: org?.name || program.org,
      program: program.name,
      wire: wire || program.wires?.[0] || null,
      evidence: sources[0].url,
      change: {
        [`programs/${program.id}.yaml`]: {
          round_disposition: { name: round.name, status: body.disposition },
          sources: urls,
        },
      },
      identity,
      reason,
      sources,
      at,
    }),
  };
}
