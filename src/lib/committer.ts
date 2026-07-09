// Server-only: mutates registry/ FILES per approved proposal (the only door
// into the canonical dataset besides Sov's own hand), then tries a local git
// commit for provenance + undo. Field order in every written YAML file
// follows registry/SCHEMA.md exactly.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import YAML from 'yaml';
import { loadRegistry } from './registry';
import type { Award, Org, Proposal, Program, Round, Wire } from './types';

const REPO_ROOT = process.cwd();
const REGISTRY = join(REPO_ROOT, 'registry');
const DATA_DIR = join(REPO_ROOT, '.data');
const PENDING_COMMITS = join(DATA_DIR, 'pending-commits.jsonl');

export interface AppliedChange {
  path: string; // repo-relative, e.g. "registry/orgs/foo.yaml"
  content: string; // full new file contents (create/update) or the bytes to append (append)
  op: 'create' | 'update' | 'append';
}

export interface ApplyResult {
  changes: AppliedChange[];
  notes: string[];
}

// ---- small helpers ----

function dedupe(arr: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const x of arr) if (x && !out.includes(x)) out.push(x);
  return out;
}

function uniqArr(a: string[] = [], b: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of [...a, ...b]) {
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function safeParseYaml<T>(path: string): T | null {
  try {
    return YAML.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

const COMBINING_MARKS = /[̀-ͯ]/g;

function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ---- field-order builders (mirror registry/SCHEMA.md exactly) ----

function orgDocToYamlObject(o: Org): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: o.id,
    name: o.name,
    aka: o.aka ?? [],
    systems: o.systems ?? [],
    wires: o.wires ?? [],
    roles: o.roles ?? ['funder'],
  };
  if (o.org_type) out.org_type = o.org_type;
  if (o.website) out.website = o.website;
  if (o.socials && Object.keys(o.socials).length) out.socials = o.socials;
  out.status = o.status;
  out.profile = o.profile;
  if (o.funding && Object.keys(o.funding).length) out.funding = o.funding;
  out.sources = o.sources ?? [];
  return out;
}

function programDocToYamlObject(p: Program): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    org: p.org,
    parent: p.parent ?? null,
    systems: p.systems ?? [],
    wires: p.wires ?? [],
    status: p.status,
  };
  if (p.mechanism) out.mechanism = p.mechanism;
  if (p.apply_url) out.apply_url = p.apply_url;
  out.summary = p.summary;
  out.rounds = p.rounds ?? [];
  out.sources = p.sources ?? [];
  return out;
}

function toYaml(doc: Record<string, unknown>): string {
  return YAML.stringify(doc, { lineWidth: 100 });
}

// ---- new_org / new_program ----

function buildNewOrgChange(slug: string, input: Record<string, unknown>, p: Proposal): AppliedChange {
  const path = join(REGISTRY, 'orgs', `${slug}.yaml`);
  const existing = existsSync(path) ? safeParseYaml<Org>(path) : null;
  const inputWires = Array.isArray(input.wires) ? (input.wires as Wire[]) : p.wire ? [p.wire] : [];
  const built: Org = {
    id: (input.id as string) || slug,
    name: (input.name as string) || p.org_name || existing?.name || slug,
    aka: uniqArr(existing?.aka, Array.isArray(input.aka) ? (input.aka as string[]) : []),
    systems: uniqArr(existing?.systems, Array.isArray(input.systems) ? (input.systems as string[]) : []),
    wires: uniqArr(existing?.wires, inputWires) as Wire[],
    roles: uniqArr(
      existing?.roles,
      Array.isArray(input.roles) && input.roles.length ? (input.roles as string[]) : ['funder']
    ) as Org['roles'],
    org_type: (input.org_type as Org['org_type']) || existing?.org_type,
    website: (input.website as string) || existing?.website,
    socials: (input.socials as Record<string, string>) || existing?.socials,
    status: (input.status as Org['status']) || existing?.status || 'unknown',
    profile: (input.profile as string) || existing?.profile || p.summary,
    funding: (input.funding as Org['funding']) || existing?.funding,
    sources: dedupe([...(existing?.sources || []), ...(Array.isArray(input.sources) ? (input.sources as string[]) : []), p.evidence_url]),
  };
  return { path: `registry/orgs/${slug}.yaml`, content: toYaml(orgDocToYamlObject(built)), op: existing ? 'update' : 'create' };
}

function buildNewProgramChange(slug: string, input: Record<string, unknown>, p: Proposal, orgId: string): AppliedChange {
  const path = join(REGISTRY, 'programs', `${slug}.yaml`);
  const existing = existsSync(path) ? safeParseYaml<Program>(path) : null;
  const built: Program = {
    id: (input.id as string) || slug,
    name: (input.name as string) || existing?.name || p.program || p.title,
    org: orgId,
    parent: (input.parent as string | null | undefined) ?? existing?.parent ?? null,
    systems: uniqArr(existing?.systems, Array.isArray(input.systems) ? (input.systems as string[]) : []),
    wires: uniqArr(
      existing?.wires,
      Array.isArray(input.wires) ? (input.wires as string[]) : p.wire ? [p.wire] : []
    ) as Wire[],
    status: (input.status as Program['status']) || existing?.status || 'unknown',
    mechanism: (input.mechanism as Program['mechanism']) || existing?.mechanism,
    apply_url: (input.apply_url as string) || existing?.apply_url,
    summary: (input.summary as string) || existing?.summary || p.summary,
    rounds: mergeRounds(existing?.rounds || [], input.rounds, p.evidence_url),
    sources: dedupe([...(existing?.sources || []), ...(Array.isArray(input.sources) ? (input.sources as string[]) : []), p.evidence_url]),
  };
  return {
    path: `registry/programs/${slug}.yaml`,
    content: toYaml(programDocToYamlObject(built)),
    op: existing ? 'update' : 'create',
  };
}

// ---- round_update / deadline_change / status_change ----

function mergeRounds(existing: Round[], incoming: unknown, evidenceUrl?: string | null): Round[] {
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;
  const rounds = existing.map((r) => ({ ...r }));
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<Round>;
    if (!r.name) continue;
    const key = r.name.toLowerCase().trim();
    const idx = rounds.findIndex((x) => x.name.toLowerCase().trim() === key);
    const base: Round = idx >= 0 ? rounds[idx] : { name: r.name, status: 'announced' };
    const merged: Round = {
      name: r.name,
      status: r.status || base.status,
      opens: r.opens ?? base.opens,
      closes: r.closes ?? base.closes,
      size: r.size ?? base.size,
      source: r.source ?? base.source ?? evidenceUrl ?? undefined,
    };
    const clean = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as unknown as Round;
    if (idx >= 0) rounds[idx] = clean;
    else rounds.push(clean);
  }
  return rounds;
}

/** Raw shapes vary: some proposals key the patch under "programs/<slug>.yaml",
 *  others hand over bare fields (rounds/status/...) and expect us to resolve
 *  the target program from org + program title. Handle both. */
function extractProgramPatch(pc: Record<string, unknown>): { slug?: string; patch: Record<string, unknown> } {
  for (const [k, v] of Object.entries(pc)) {
    const m = /^programs\/(.+)\.yaml$/.exec(k);
    if (m && v && typeof v === 'object') return { slug: m[1], patch: v as Record<string, unknown> };
  }
  return { patch: pc };
}

function resolveProgramSlug(p: Proposal, hintSlug?: string): string {
  if (hintSlug) {
    if (!existsSync(join(REGISTRY, 'programs', `${hintSlug}.yaml`))) {
      throw new Error(`Program file not found: programs/${hintSlug}.yaml`);
    }
    return hintSlug;
  }
  if (!p.org) throw new Error(`${p.type} proposal "${p.id}" has no org to resolve a program against`);
  const { programs } = loadRegistry();
  const candidates = programs.filter((pr) => pr.org === p.org);
  if (candidates.length === 0) throw new Error(`No programs on file for org "${p.org}"`);
  if (candidates.length === 1) return candidates[0].id;
  const norm = (s: string) => s.toLowerCase().trim();
  const title = p.program ? norm(p.program) : '';
  let match = title ? candidates.find((pr) => norm(pr.name) === title) : undefined;
  if (!match && title) match = candidates.find((pr) => norm(pr.name).includes(title) || title.includes(norm(pr.name)));
  if (!match) throw new Error(`Could not match program "${p.program ?? ''}" among ${candidates.length} programs for org "${p.org}"`);
  return match.id;
}

function buildProgramFieldUpdate(p: Proposal): AppliedChange {
  const pc = (p.proposed_change || {}) as Record<string, unknown>;
  const { slug: hintSlug, patch } = extractProgramPatch(pc);
  const slug = resolveProgramSlug(p, hintSlug);
  const path = join(REGISTRY, 'programs', `${slug}.yaml`);
  const current = safeParseYaml<Program>(path);
  if (!current) throw new Error(`Program file unreadable: programs/${slug}.yaml`);
  const next: Program = {
    ...current,
    status: typeof patch.status === 'string' ? (patch.status as Program['status']) : current.status,
    apply_url: typeof patch.apply_url === 'string' ? (patch.apply_url as string) : current.apply_url,
    rounds: mergeRounds(current.rounds || [], patch.rounds, p.evidence_url),
    sources: dedupe([...(current.sources || []), ...(Array.isArray(patch.sources) ? (patch.sources as string[]) : []), p.evidence_url]),
  };
  return { path: `registry/programs/${slug}.yaml`, content: toYaml(programDocToYamlObject(next)), op: 'update' };
}

// ---- new_award ----

function buildAwardChange(p: Proposal): AppliedChange {
  const pc = (p.proposed_change || {}) as Record<string, unknown>;
  let input: Record<string, unknown> | null = null;
  let yearHint: string | null = null;
  for (const [k, v] of Object.entries(pc)) {
    const m = /^awards\/(.+)\.jsonl$/.exec(k);
    if (m && v && typeof v === 'object') {
      input = v as Record<string, unknown>;
      yearHint = m[1];
      break;
    }
  }
  if (!input) input = pc;

  const funderName = (input.funder_name as string) || p.org_name || (input.funder as string) || 'Unknown funder';
  const funder = (input.funder as string) || p.org || slugify(funderName);
  const granteeName = (input.grantee_name as string) || 'Unknown grantee';
  const grantee = (input.grantee as string) || slugify(granteeName);
  const date = (input.date as string) || null;
  const amountText = (input.amount_text as string) || null;
  const award: Award = {
    funder,
    funder_name: funderName,
    grantee,
    grantee_name: granteeName,
    amount: typeof input.amount === 'number' ? (input.amount as number) : null,
    currency: (input.currency as string) || null,
    amount_text: amountText,
    date,
    program: (input.program as string) || null,
    program_name: (input.program_name as string) || null,
    wire: (input.wire as Wire) || p.wire || null,
    source: (input.source as string) || p.evidence_url || null,
    key: `${funder}|${grantee}|${date || ''}|${amountText || ''}`.toLowerCase(),
  };
  const year = yearHint || (date ? date.slice(0, 4) : 'undated');
  return { path: `registry/awards/${year}.jsonl`, content: `${JSON.stringify(award)}\n`, op: 'append' };
}

// ---- profile_note ----

function buildProfileNoteChange(p: Proposal, notes: string[]): AppliedChange | null {
  const pc = (p.proposed_change || {}) as Record<string, unknown>;
  const profileText = typeof pc.profile === 'string' ? pc.profile.trim() : '';
  if (!profileText || !p.org) {
    notes.push('no-op: proposed_change.profile not present');
    return null;
  }
  const path = join(REGISTRY, 'orgs', `${p.org}.yaml`);
  const existing = existsSync(path) ? safeParseYaml<Org>(path) : null;
  if (!existing) {
    notes.push(`no-op: org "${p.org}" not found`);
    return null;
  }
  const nextProfile = existing.profile ? `${existing.profile.trim()}\n\n${profileText}` : profileText;
  const merged: Org = {
    ...existing,
    profile: nextProfile,
    sources: dedupe([...(existing.sources || []), p.evidence_url]),
  };
  return { path: `registry/orgs/${p.org}.yaml`, content: toYaml(orgDocToYamlObject(merged)), op: 'update' };
}

// ---- dispatcher ----

/** Pure: computes what would change, without writing anything. Used both for
 *  the /api/desk/preview dry run and as the first step of applyProposal. */
export function buildProposalChanges(p: Proposal): ApplyResult {
  const pc = (p.proposed_change || {}) as Record<string, unknown>;
  const notes: string[] = [];
  const changes: AppliedChange[] = [];

  switch (p.type) {
    case 'new_org': {
      const orgEntries = Object.entries(pc).filter(([k]) => /^orgs\/(.+)\.yaml$/.test(k));
      const programEntries = Object.entries(pc).filter(([k]) => /^programs\/(.+)\.yaml$/.test(k));
      if (orgEntries.length === 0) throw new Error('new_org proposal has no orgs/<slug>.yaml entry in proposed_change');
      const createdOrgIds = new Set<string>();
      for (const [key, value] of orgEntries) {
        const slug = /^orgs\/(.+)\.yaml$/.exec(key)![1];
        const val = (value || {}) as Record<string, unknown>;
        changes.push(buildNewOrgChange(slug, val, p));
        createdOrgIds.add((val.id as string) || slug);
      }
      for (const [key, value] of programEntries) {
        const slug = /^programs\/(.+)\.yaml$/.exec(key)![1];
        const val = (value || {}) as Record<string, unknown>;
        const orgId = (val.org as string) || [...createdOrgIds][0] || p.org || undefined;
        if (!orgId) {
          notes.push(`skipped ${key}: no org reference`);
          continue;
        }
        if (!createdOrgIds.has(orgId) && !existsSync(join(REGISTRY, 'orgs', `${orgId}.yaml`))) {
          notes.push(`skipped ${key}: org "${orgId}" does not exist`);
          continue;
        }
        changes.push(buildNewProgramChange(slug, val, p, orgId));
      }
      break;
    }
    case 'new_program': {
      const programEntries = Object.entries(pc).filter(([k]) => /^programs\/(.+)\.yaml$/.test(k));
      if (programEntries.length === 0) throw new Error('new_program proposal has no programs/<slug>.yaml entry in proposed_change');
      for (const [key, value] of programEntries) {
        const slug = /^programs\/(.+)\.yaml$/.exec(key)![1];
        const val = (value || {}) as Record<string, unknown>;
        const orgId = (val.org as string) || p.org || undefined;
        if (!orgId) throw new Error(`new_program "${slug}" missing org reference`);
        if (!existsSync(join(REGISTRY, 'orgs', `${orgId}.yaml`))) {
          throw new Error(`new_program "${slug}": org "${orgId}" does not exist in registry/orgs`);
        }
        changes.push(buildNewProgramChange(slug, val, p, orgId));
      }
      break;
    }
    case 'round_update':
    case 'deadline_change':
    case 'status_change': {
      changes.push(buildProgramFieldUpdate(p));
      break;
    }
    case 'new_award': {
      changes.push(buildAwardChange(p));
      break;
    }
    case 'profile_note': {
      const change = buildProfileNoteChange(p, notes);
      if (change) changes.push(change);
      break;
    }
    case 'merge_orgs': {
      notes.push('merge tooling later: recorded as a decision only, no files changed');
      break;
    }
    default: {
      const exhaustive: never = p.type;
      throw new Error(`Unknown proposal type: ${exhaustive}`);
    }
  }

  return { changes, notes };
}

/** Writes buildProposalChanges' output to disk. */
export function applyProposal(p: Proposal): ApplyResult {
  const result = buildProposalChanges(p);
  for (const c of result.changes) {
    const abs = join(REPO_ROOT, c.path);
    mkdirSync(dirname(abs), { recursive: true });
    if (c.op === 'append') appendFileSync(abs, c.content, 'utf8');
    else writeFileSync(abs, c.content, 'utf8');
  }
  return result;
}

export function commitMessageFor(p: Proposal): string {
  const lines = [`${p.type}: ${p.title}`, ''];
  if (p.evidence_url) lines.push(`Source: ${p.evidence_url}`);
  lines.push(`Proposal: ${p.id}`);
  return lines.join('\n');
}

function appendPendingCommit(entry: { files: string[]; message: string; at: string }): void {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(PENDING_COMMITS, `${JSON.stringify(entry)}\n`, 'utf8');
}

/** Best-effort local git commit, scoped to registry/ only. On any failure
 *  (no git repo, nothing to commit, etc.) the change is logged to
 *  .data/pending-commits.jsonl and this returns null — the file mutation
 *  already happened and is never rolled back. */
export function commitChange(files: string[], message: string): string | null {
  if (files.length === 0) return null;
  if (process.env.GRANTS_WATCH_NO_GIT === '1') return null;
  try {
    execFileSync('git', ['add', '-A', 'registry'], { cwd: REPO_ROOT, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', message, '--author', 'The Desk <desk@grants.watch>'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, stdio: 'pipe' }).toString().trim();
  } catch {
    appendPendingCommit({ files, message, at: new Date().toISOString() });
    return null;
  }
}
