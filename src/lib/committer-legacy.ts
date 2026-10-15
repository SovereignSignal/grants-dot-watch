// Server-only: mutates registry/ FILES per approved proposal (the only door
// into the canonical dataset besides Sov's own hand), then tries a local git
// commit for provenance + undo. Field order in every written YAML file
// follows registry/SCHEMA.md exactly.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import YAML from 'yaml';
import { recordAppliedChanges, type AppliedChangeReceipt } from './desk-store';
import { invalidateRegistryCache, loadRegistry } from './registry';
import { productDateISO } from './round-state';
import type { Award, Org, Proposal, Program, Round, Wire } from './types';

const REPO_ROOT = process.cwd();
const REGISTRY = join(REPO_ROOT, 'registry');

export interface AppliedChange {
  path: string; // repo-relative, e.g. "registry/orgs/foo.yaml"
  content: string; // full new file contents (create/update) or the bytes to append (append)
  op: 'create' | 'update' | 'append';
  /** Captured immediately before writing. These make durable replay
   *  compare-and-set safe instead of a blind full-file overwrite. */
  content_before?: string | null;
  content_after?: string;
}

export interface ApplyResult {
  changes: AppliedChange[];
  notes: string[];
}

export class RegistryMutationError extends Error {
  readonly registryMayHaveChanged: boolean;

  constructor(message: string, registryMayHaveChanged: boolean, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RegistryMutationError';
    this.registryMayHaveChanged = registryMayHaveChanged;
  }
}

export function registryMayHaveChanged(error: unknown): boolean {
  return error instanceof RegistryMutationError && error.registryMayHaveChanged;
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

export function slugify(s: string): string {
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
  if (p.parent_round) out.parent_round = p.parent_round;
  if (p.mechanism) out.mechanism = p.mechanism;
  if (p.apply_url) out.apply_url = p.apply_url;
  out.summary = p.summary;
  out.rounds = p.rounds ?? [];
  if (p.review) out.review = p.review;
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
    parent_round: (input.parent_round as string | null | undefined) ?? existing?.parent_round ?? null,
    systems: uniqArr(existing?.systems, Array.isArray(input.systems) ? (input.systems as string[]) : []),
    wires: uniqArr(
      existing?.wires,
      Array.isArray(input.wires) ? (input.wires as string[]) : p.wire ? [p.wire] : []
    ) as Wire[],
    status: (input.status as Program['status']) || existing?.status || 'unknown',
    mechanism: (input.mechanism as Program['mechanism']) || existing?.mechanism,
    apply_url: (input.apply_url as string) || existing?.apply_url,
    summary: (input.summary as string) || existing?.summary || p.summary,
    review: (input.review as Program['review']) || existing?.review,
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
      // Keep an exact instant only while its stated closing date still applies.
      closes_at: r.closes_at ?? (r.closes == null || r.closes === base.closes ? base.closes_at : undefined),
      size: r.size ?? base.size,
      source: r.source ?? base.source ?? evidenceUrl ?? undefined,
    };
    // Recency guard: a round whose deadline has already passed is closed by
    // definition — never written as open/announced regardless of what the
    // (possibly historical) evidence page states.
    const todayISO = productDateISO();
    if (merged.closes && String(merged.closes) < todayISO && (merged.status === 'open' || merged.status === 'announced')) {
      merged.status = 'closed';
    }
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

function roundKey(name: string): string {
  return name.toLowerCase().trim();
}

/** Copies missing facts from a retired duplicate onto the round that remains,
 *  then drops the duplicate. A withdrawn or duplicate mark stays on the round
 *  so its name, dates, and source remain in the file while it leaves open lists. */
function applyRoundEdits(rounds: Round[], patch: Record<string, unknown>): { rounds: Round[]; extraSources: string[]; retired: string | null } {
  let next = rounds.map((round) => ({ ...round }));
  const extraSources: string[] = [];
  const disposition = patch.round_disposition;
  if (disposition && typeof disposition === 'object' && !Array.isArray(disposition)) {
    const record = disposition as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const status = record.status;
    if (!name) throw new Error('round_disposition needs a round name');
    if (status !== 'withdrawn' && status !== 'duplicate') throw new Error('round_disposition status must be withdrawn or duplicate');
    const idx = next.findIndex((round) => roundKey(round.name) === roundKey(name));
    if (idx < 0) throw new Error(`round not found: ${name}`);
    next[idx] = { ...next[idx], status };
  }

  const retire = typeof patch.retire_round === 'string' ? patch.retire_round.trim() : '';
  if (!retire) return { rounds: next, extraSources, retired: null };
  const retireIdx = next.findIndex((round) => roundKey(round.name) === roundKey(retire));
  if (retireIdx < 0) throw new Error(`round not found: ${retire}`);
  const keep = typeof patch.keep_round === 'string' ? patch.keep_round.trim() : '';
  if (!keep) throw new Error('keep_round is required when retiring a round');
  if (roundKey(keep) === roundKey(retire)) throw new Error('keep_round and retire_round must name different rounds');
  const keepIdx = next.findIndex((round) => roundKey(round.name) === roundKey(keep));
  if (keepIdx < 0) throw new Error(`round not found: ${keep}`);
  const retiring = next[retireIdx];
  const kept = { ...next[keepIdx] };
  if (!kept.opens && retiring.opens) kept.opens = retiring.opens;
  if (!kept.closes && retiring.closes) kept.closes = retiring.closes;
  if (!kept.closes_at && retiring.closes_at) kept.closes_at = retiring.closes_at;
  if (!kept.size && retiring.size) kept.size = retiring.size;
  if (!kept.source && retiring.source) kept.source = retiring.source;
  if (retiring.source) extraSources.push(retiring.source);
  next[keepIdx] = kept;
  next = next.filter((_, index) => index !== retireIdx);
  return { rounds: next, extraSources, retired: retire };
}

function buildProgramFieldUpdate(p: Proposal): AppliedChange {
  const pc = (p.proposed_change || {}) as Record<string, unknown>;
  const { slug: hintSlug, patch } = extractProgramPatch(pc);
  const slug = resolveProgramSlug(p, hintSlug);
  const path = join(REGISTRY, 'programs', `${slug}.yaml`);
  const current = safeParseYaml<Program>(path);
  if (!current) throw new Error(`Program file unreadable: programs/${slug}.yaml`);
  const edited = applyRoundEdits(mergeRounds(current.rounds || [], patch.rounds, p.evidence_url), patch);
  const explicitSummary = typeof patch.summary === 'string' && patch.summary.trim() ? patch.summary.trim() : '';
  const statusSummary = p.type === 'status_change' && typeof p.summary === 'string' && p.summary.trim() ? p.summary.trim() : '';
  const next: Program = {
    ...current,
    status: typeof patch.status === 'string' ? (patch.status as Program['status']) : current.status,
    apply_url: typeof patch.apply_url === 'string' ? (patch.apply_url as string) : current.apply_url,
    summary: explicitSummary || statusSummary || current.summary,
    rounds: edited.rounds,
    sources: dedupe([
      ...(current.sources || []),
      ...(Array.isArray(patch.sources) ? (patch.sources as string[]) : []),
      ...edited.extraSources,
      p.evidence_url,
    ]),
  };
  if (edited.retired && next.review?.round_names?.length) {
    const retiredKey = roundKey(edited.retired);
    next.review = {
      ...next.review,
      round_names: next.review.round_names.filter((name) => roundKey(name) !== retiredKey),
    };
  }
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
//
// Shapes actually present in the seed data (surveyed 2026-07-11 across every
// seed/proposals-*batch-*.json profile_note item — the literal
// {field, current, proposed} audit shape does NOT occur; the batch-5 audit
// corrections are file-keyed field maps like everything else):
//   (1) { profile: "<text>" }                        → append a paragraph to the
//       proposal org's profile (the original behavior, kept verbatim)
//   (2) { "orgs/<slug>.yaml": {field: value, ...},
//         "programs/<slug>.yaml": {...} }            → field-level updates to the
//       referenced registry file — a map value is the field's NEW value
//       (arrays replace: roles ["funder"]→["ecosystem"] is a correction)
//   (3) top-level action / remove keys               → advisory or destructive;
//       never automated, surfaced as a note for the owner's hand
// Unknown fields inside a map (…_flag, review_note, profile_note,
// profile_project_counts, summary_amount, …) are curator-facing prose that
// would need an editorial rewrite to land — skipped with an explicit note.
// Never guess.

const ORG_SET_FIELDS = new Set(['name', 'aka', 'systems', 'wires', 'roles', 'org_type', 'website', 'status', 'profile']);
const ORG_MERGE_OBJECT_FIELDS = new Set(['socials', 'funding']);
const PROGRAM_SET_FIELDS = new Set(['name', 'parent', 'parent_round', 'status', 'mechanism', 'apply_url', 'summary', 'review']);
const PROGRAM_WIRES = new Set(['crypto', 'ai', 'oss']);

/** A wire move replaces the program's wire list. Empty, unknown, or repeated
 *  values are refused so an approval cannot write a file the validator rejects. */
function programWires(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > PROGRAM_WIRES.size) return null;
  const wires: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !PROGRAM_WIRES.has(item) || wires.includes(item)) return null;
    wires.push(item);
  }
  return wires;
}

function appendParagraph(existing: unknown, addition: string): string {
  const base = typeof existing === 'string' ? existing.trim() : '';
  return base ? `${base}\n\n${addition.trim()}` : addition.trim();
}

function mergeSources(current: unknown, incoming: unknown): string[] {
  const cur = Array.isArray(current) ? (current as string[]) : [];
  const inc = Array.isArray(incoming) ? (incoming as string[]) : [];
  return dedupe([...cur, ...inc]);
}

/** Field-level update of one orgs/<slug>.yaml from a profile_note field map.
 *  Creates the file only when the map itself carries name + profile (the
 *  deliberate-create case, e.g. the olmo→Ai2 replacement); a partial update
 *  against a missing file is a no-op with a note, never a guessed stub. */
function applyOrgFieldMap(slug: string, map: Record<string, unknown>, p: Proposal, notes: string[]): AppliedChange | null {
  // Apply-time value guard (all paths — Desk clicks, bulk, triage API, validator):
  // bare domains get https://, and enum fields reject invalid values here rather
  // than writing schema-breaking data the validator only catches later.
  const ORG_STATUSES = new Set(['active', 'winding-down', 'dormant', 'dead', 'unknown']);
  const urlish = (v: unknown): unknown =>
    typeof v === 'string' && v && !/^https?:\/\//.test(v) && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i.test(v)
      ? `https://${v}`
      : v;
  for (const k of ['website', 'apply_url']) if (k in map) map[k] = urlish(map[k]);
  if (Array.isArray(map.sources)) map.sources = (map.sources as unknown[]).map(urlish);
  if (map.socials && typeof map.socials === 'object')
    for (const [sk, sv] of Object.entries(map.socials as Record<string, unknown>))
      if (sv !== null) (map.socials as Record<string, unknown>)[sk] = urlish(sv);
  if ('status' in map && typeof map.status === 'string' && !ORG_STATUSES.has(map.status)) {
    notes.push(`status "${map.status}" is not a valid org status, skipped, never guessed`);
    delete map.status;
  }

  const fileRel = `orgs/${slug}.yaml`;
  const path = join(REGISTRY, fileRel);
  const existing = existsSync(path) ? safeParseYaml<Org>(path) : null;
  if (!existing && !(typeof map.name === 'string' && typeof map.profile === 'string')) {
    notes.push(`no-op ${fileRel}: file not found, and the map lacks name+profile to create it`);
    return null;
  }
  const base: Org =
    existing ??
    ({ id: slug, name: '', aka: [], systems: [], wires: [], roles: ['funder'], status: 'unknown', profile: '', sources: [] } as Org);
  const next = { ...base } as Record<string, unknown>;
  let touched = false;

  for (const [field, value] of Object.entries(map)) {
    if (field === 'id') {
      if (value !== slug) notes.push(`${fileRel}: ignored id "${String(value)}", a file's identity is its path`);
      continue;
    }
    if (ORG_SET_FIELDS.has(field)) {
      next[field] = value;
      touched = true;
      continue;
    }
    if (ORG_MERGE_OBJECT_FIELDS.has(field) && value && typeof value === 'object' && !Array.isArray(value)) {
      const merged = { ...((next[field] as Record<string, unknown>) || {}) };
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        // socials.x: null clears that one field. It does not delete the org file.
        if (field === 'socials' && item === null) {
          delete merged[key];
          continue;
        }
        merged[key] = item;
      }
      if (Object.keys(merged).length) next[field] = merged;
      else delete next[field];
      touched = true;
      continue;
    }
    const dotted = /^(funding|socials)\.([a-z_]+)$/.exec(field);
    if (dotted) {
      next[dotted[1]] = { ...((next[dotted[1]] as Record<string, unknown>) || {}), [dotted[2]]: value };
      touched = true;
      continue;
    }
    if (field === 'sources' || field === 'sources_add') {
      next.sources = mergeSources(next.sources, value);
      touched = true;
      continue;
    }
    if (field === 'profile_update' && typeof value === 'string' && value.trim()) {
      next.profile = appendParagraph(next.profile, value);
      touched = true;
      continue;
    }
    notes.push(`${fileRel}: field "${field}" needs the owner's hand, skipped, never guessed`);
  }

  if (!touched) {
    notes.push(`no-op ${fileRel}: nothing auto-applicable in the field map`);
    return null;
  }
  next.sources = dedupe([...((next.sources as string[]) || []), p.evidence_url]);
  return { path: `registry/${fileRel}`, content: toYaml(orgDocToYamlObject(next as unknown as Org)), op: existing ? 'update' : 'create' };
}

/** Field-level update of one programs/<slug>.yaml. Update-only: profile_note
 *  never creates program files (that's new_program's job). */
function applyProgramFieldMap(slug: string, map: Record<string, unknown>, p: Proposal, notes: string[]): AppliedChange | null {
  const fileRel = `programs/${slug}.yaml`;
  const path = join(REGISTRY, fileRel);
  const existing = existsSync(path) ? safeParseYaml<Program>(path) : null;
  if (!existing) {
    notes.push(`no-op ${fileRel}: file not found, profile_note never creates program files`);
    return null;
  }
  const next = { ...existing } as Record<string, unknown>;
  let touched = false;

  for (const [field, value] of Object.entries(map)) {
    if (field === 'id') {
      if (value !== slug) notes.push(`${fileRel}: ignored id "${String(value)}", a file's identity is its path`);
      continue;
    }
    if (field === 'wires') {
      const wires = programWires(value);
      if (!wires) throw new Error(`${fileRel}: wires must be a non-empty list of crypto, ai, or oss`);
      next.wires = wires;
      touched = true;
      continue;
    }
    if (PROGRAM_SET_FIELDS.has(field)) {
      next[field] = value;
      touched = true;
      continue;
    }
    if ((field === 'summary_update' || field === 'summary_add') && typeof value === 'string' && value.trim()) {
      next.summary = appendParagraph(next.summary, value);
      touched = true;
      continue;
    }
    if (field === 'sources' || field === 'sources_add') {
      next.sources = mergeSources(next.sources, value);
      touched = true;
      continue;
    }
    if (field === 'rounds' && Array.isArray(value)) {
      next.rounds = mergeRounds((next.rounds as Round[]) || [], value, p.evidence_url);
      touched = true;
      continue;
    }
    if (field === 'rounds_replace') {
      if (!Array.isArray(value)) throw new Error('rounds_replace must be an array');
      if (!p.proposed_change?._expected_content_hashes) throw new Error('rounds_replace requires captured content hashes');
      next.rounds = value;
      touched = true;
      continue;
    }
    if (field === 'add_round' && value && typeof value === 'object' && !Array.isArray(value)) {
      next.rounds = mergeRounds((next.rounds as Round[]) || [], [value], p.evidence_url);
      touched = true;
      continue;
    }
    notes.push(`${fileRel}: field "${field}" needs the owner's hand, skipped, never guessed`);
  }

  if (!touched) {
    notes.push(`no-op ${fileRel}: nothing auto-applicable in the field map`);
    return null;
  }
  next.sources = dedupe([...((next.sources as string[]) || []), p.evidence_url]);
  return { path: `registry/${fileRel}`, content: toYaml(programDocToYamlObject(next as unknown as Program)), op: 'update' };
}

function buildProfileNoteChanges(p: Proposal, notes: string[]): AppliedChange[] {
  const pc = (p.proposed_change || {}) as Record<string, unknown>;
  const changes: AppliedChange[] = [];

  const fileEntries = Object.entries(pc).filter(
    ([k, v]) => /^(orgs|programs)\/.+\.yaml$/.test(k) && v != null && typeof v === 'object'
  );

  if (fileEntries.length > 0) {
    // shape (2): file-keyed field maps
    for (const [key, value] of fileEntries) {
      const m = /^(orgs|programs)\/(.+)\.yaml$/.exec(key)!;
      const change =
        m[1] === 'orgs'
          ? applyOrgFieldMap(m[2], value as Record<string, unknown>, p, notes)
          : applyProgramFieldMap(m[2], value as Record<string, unknown>, p, notes);
      if (change) changes.push(change);
    }
  } else if (typeof pc.profile === 'string' && pc.profile.trim() && p.org) {
    // shape (1): top-level profile string — append to the org's profile (original behavior)
    const path = join(REGISTRY, 'orgs', `${p.org}.yaml`);
    const existing = existsSync(path) ? safeParseYaml<Org>(path) : null;
    if (!existing) {
      notes.push(`no-op: org "${p.org}" not found`);
    } else {
      const merged: Org = {
        ...existing,
        profile: appendParagraph(existing.profile, pc.profile),
        sources: dedupe([...(existing.sources || []), p.evidence_url]),
      };
      changes.push({ path: `registry/orgs/${p.org}.yaml`, content: toYaml(orgDocToYamlObject(merged)), op: 'update' });
    }
  }

  // shape (3): advisory / destructive top-level keys — named honestly, never executed
  if (typeof pc.action === 'string') notes.push(`action "${pc.action}" is not automated, needs the owner's hand`);
  if (typeof pc.remove === 'string') notes.push(`destructive remove of ${pc.remove} skipped, deletions are never automated from a proposal`);

  if (changes.length === 0 && notes.length === 0) notes.push('no-op: proposed_change has nothing auto-applicable');
  return changes;
}

// ---- dispatcher ----

/** Pure: computes what would change, without writing anything. Used both for
 *  the /api/desk/preview dry run and as the first step of applyProposal. */
export function buildProposalChanges(p: Proposal): ApplyResult {
  const pc = (p.proposed_change || {}) as Record<string, unknown>;
  // Research corrections are tied to the exact files the researcher read.
  // Existing proposals without this optional guard keep their current behavior.
  if ('_expected_content_hashes' in pc) {
    const hashes = pc._expected_content_hashes;
    if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) throw new Error('Invalid expected content hashes');
    const targets = Object.keys(pc).filter(k => /^(orgs|programs)\//.test(k));
    if (!targets.length) throw new Error('Content hashes need registry targets');
    for (const key of targets) if (!(key in hashes)) throw new Error(`Missing expected hash for ${key}`);
    for (const [key, expected] of Object.entries(hashes)) {
      if (!/^(orgs|programs)\/[a-z0-9][a-z0-9-]*\.yaml$/.test(key)) throw new Error('Invalid expected hash path');
      if (expected !== null && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))) throw new Error('Invalid expected content hash');
      const path = join(REGISTRY, key);
      const actual = existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
      if (actual !== expected) throw new Error(`Research correction is stale: ${key} changed. Recheck before approval.`);
    }
  }
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
      // Some of these target the ORG file, not a program (e.g. an org status
      // change, or an org whose registry entry has no program files). If the
      // change map is keyed by orgs/<slug>.yaml, route it through the org
      // field-map path instead of forcing a program resolution that can't
      // succeed ("No programs on file for org ...").
      const pc = (p.proposed_change || {}) as Record<string, unknown>;
      const orgKeyed = Object.entries(pc).filter(
        ([k, v]) => /^orgs\/(.+)\.yaml$/.test(k) && v && typeof v === 'object'
      );
      if (orgKeyed.length > 0) {
        for (const [key, value] of orgKeyed) {
          const slug = /^orgs\/(.+)\.yaml$/.exec(key)![1];
          let map = value as Record<string, unknown>;
          // A status submission's summary is the public profile. Older rows
          // stored it only on the proposal, so approval copies it across.
          if (p.type === 'status_change') {
            map = { ...map };
            if (typeof map.summary === 'string' && map.summary.trim() && typeof map.profile !== 'string') map.profile = map.summary.trim();
            else if (typeof map.profile !== 'string' && typeof p.summary === 'string' && p.summary.trim()) map.profile = p.summary.trim();
            delete map.summary;
          }
          const change = applyOrgFieldMap(slug, map, p, notes);
          if (change) changes.push(change);
        }
      } else {
        changes.push(buildProgramFieldUpdate(p));
      }
      break;
    }
    case 'new_award': {
      changes.push(buildAwardChange(p));
      break;
    }
    case 'profile_note': {
      changes.push(...buildProfileNoteChanges(p, notes));
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

/** Computes + writes a proposal's file changes to disk. Does NOT invalidate
 *  the registry cache — a caller applying many proposals in a batch (e.g.
 *  /api/desk/decide-bulk) should invalidate once after the whole batch lands,
 *  not once per item. Single-proposal callers should use applyProposal below,
 *  which invalidates immediately. */
function materializeChanges(changes: AppliedChange[]): AppliedChange[] {
  const virtual = new Map<string, string | null>();
  for (const change of changes) {
    const abs = join(REPO_ROOT, change.path);
    const before = virtual.has(change.path)
      ? virtual.get(change.path)!
      : existsSync(abs)
        ? readFileSync(abs, 'utf8')
        : null;
    const after = change.op === 'append' ? `${before ?? ''}${change.content}` : change.content;
    change.content_before = before;
    change.content_after = after;
    virtual.set(change.path, after);
  }
  return changes;
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, path);
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // The canonical destination was not affected by temp-file cleanup.
    }
    throw error;
  }
}

function gitFileContent(spec: string): string | null {
  try {
    return execFileSync('git', ['show', spec], { cwd: REPO_ROOT, stdio: 'pipe' }).toString();
  } catch {
    return null;
  }
}

/** Reject exact target paths that already carry owner edits. Paths changed by
 *  an earlier proposal in the same batch are allowed only while their live
 *  bytes still match the batch's last known snapshot. */
export function assertCleanGitPaths(
  changes: AppliedChange[],
  allowedDirtySnapshots: ReadonlyMap<string, string> = new Map()
): void {
  if (process.env.GRANTS_WATCH_NO_GIT === '1') return;
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: REPO_ROOT, stdio: 'pipe' });
  } catch {
    return;
  }

  const paths = [...new Set(changes.map((change) => change.path))];
  const cleanRequired: string[] = [];
  for (const path of paths) {
    const expected = allowedDirtySnapshots.get(path);
    if (expected === undefined) {
      cleanRequired.push(path);
      continue;
    }
    const abs = join(REPO_ROOT, path);
    const live = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (live !== expected) throw new Error(`${path} changed during the current Desk batch`);
    try {
      execFileSync('git', ['diff', '--cached', '--quiet', '--', path], { cwd: REPO_ROOT, stdio: 'pipe' });
    } catch {
      throw new Error(`${path} has an exact-path staged change; refusing to absorb it`);
    }
  }
  if (cleanRequired.length === 0) return;
  const status = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all', '--', ...cleanRequired],
    { cwd: REPO_ROOT, stdio: 'pipe' }
  )
    .toString()
    .trim();
  if (status) throw new Error(`registry target already has owner edits: ${status.split('\n')[0]}`);
}

/** Captures complete before/after snapshots without mutating the filesystem. */
export function prepareProposalChanges(p: Proposal): ApplyResult {
  const result = buildProposalChanges(p);
  materializeChanges(result.changes);
  return result;
}

/** Atomically writes a prepared change set. One final rename is performed per
 *  path, so readers never observe a partially written YAML or JSONL file. */
export function writePreparedChanges(result: ApplyResult): ApplyResult {
  const finalByPath = new Map<string, { before: string | null; after: string }>();
  for (const change of result.changes) {
    if (change.content_before === undefined || change.content_after === undefined) {
      throw new Error(`change ${change.path} was not prepared before write`);
    }
    const prior = finalByPath.get(change.path);
    finalByPath.set(change.path, {
      before: prior ? prior.before : change.content_before,
      after: change.content_after,
    });
  }
  // Compare every live file before touching any path. JavaScript executes
  // this synchronous preflight and write loop without in-process interleave;
  // Postgres outbox path conflicts cover separate no-git instances.
  for (const [path, snapshot] of finalByPath) {
    const abs = join(REPO_ROOT, path);
    const live = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (live !== snapshot.before) {
      throw new Error(`${path} changed after preparation; refusing to overwrite`);
    }
  }
  const written: Array<[string, { before: string | null; after: string }]> = [];
  try {
    for (const entry of finalByPath) {
      const [path, snapshot] = entry;
      atomicWrite(join(REPO_ROOT, path), snapshot.after);
      written.push(entry);
    }
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const [path, snapshot] of written.reverse()) {
      const abs = join(REPO_ROOT, path);
      try {
        const live = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
        if (live !== snapshot.after) throw new Error('live bytes changed before rollback');
        if (snapshot.before === null) unlinkSync(abs);
        else atomicWrite(abs, snapshot.before);
      } catch (rollbackError) {
        rollbackErrors.push(`${path}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    if (rollbackErrors.length > 0) {
      throw new RegistryMutationError(
        `registry write failed (${detail}); rollback incomplete: ${rollbackErrors.join('; ')}`,
        true,
        error
      );
    }
    throw new RegistryMutationError(`registry write failed and was rolled back: ${detail}`, false, error);
  }
  return result;
}

export function writeProposalChanges(p: Proposal): ApplyResult {
  return writePreparedChanges(prepareProposalChanges(p));
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function ledgerFilesFromChanges(
  files: string[],
  changes?: AppliedChange[]
): { path: string; content_before_hash?: string | null; content_after: string }[] {
  const snapshots = new Map<string, { before: string | null; after: string }>();
  for (const change of changes || []) {
    if (change.content_after === undefined || change.content_before === undefined) continue;
    const previous = snapshots.get(change.path);
    snapshots.set(change.path, {
      before: previous ? previous.before : change.content_before,
      after: change.content_after,
    });
  }
  return files.map((path) => {
    const snapshot = snapshots.get(path);
    if (snapshot) {
      return {
        path,
        content_before_hash: snapshot.before === null ? null : sha256(snapshot.before),
        content_after: snapshot.after,
      };
    }
    return { path, content_after: readFileSync(join(REPO_ROOT, path), 'utf8') };
  });
}

function assertGitBaseSnapshots(changes: AppliedChange[] | undefined): void {
  if (!changes || changes.length === 0) return;
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: REPO_ROOT, stdio: 'pipe' });
  } catch {
    return;
  }
  const snapshots = new Map<string, { before: string | null; after: string }>();
  for (const change of changes) {
    if (change.content_before === undefined || change.content_after === undefined) {
      throw new Error(`${change.path} has no prepared git base snapshot`);
    }
    const previous = snapshots.get(change.path);
    snapshots.set(change.path, {
      before: previous ? previous.before : change.content_before,
      after: change.content_after,
    });
  }
  for (const [path, snapshot] of snapshots) {
    const head = gitFileContent(`HEAD:${path}`);
    if (head !== snapshot.before) throw new Error(`${path} HEAD changed after Desk preparation`);
    const index = gitFileContent(`:${path}`);
    const live = existsSync(join(REPO_ROOT, path)) ? readFileSync(join(REPO_ROOT, path), 'utf8') : null;
    const cleanIndex = index === head;
    const resumableDeskIndex = index === snapshot.after && live === snapshot.after;
    if (!cleanIndex && !resumableDeskIndex) {
      throw new Error(`${path} has an exact-path staged change; refusing to overwrite it`);
    }
  }
}

/** Durably records a prepared change before an ephemeral production write.
 *  Local git-backed callers can keep using commitChange's failure ledger. */
export async function recordPreparedChangeIntent(
  result: ApplyResult,
  message: string,
  proposalId?: string | null
): Promise<AppliedChangeReceipt | null> {
  if (result.changes.length === 0) return null;
  const files = [...new Set(result.changes.map((change) => change.path))];
  return recordAppliedChanges(
    {
      proposal_id: proposalId ?? null,
      files: ledgerFilesFromChanges(files, result.changes),
      message,
    },
    'prepared'
  );
}

/** Prepare, ledger first on ephemeral production, then write and commit. */
export async function applyProposalDurably(
  p: Proposal,
  message: string = commitMessageFor(p)
): Promise<ApplyResult & { commit: string | null }> {
  if (process.env.GRANTS_WATCH_NO_GIT === '1' && !process.env.DATABASE_URL) {
    throw new Error('GRANTS_WATCH_NO_GIT=1 requires DATABASE_URL for durable approvals');
  }
  const result = prepareProposalChanges(p);
  assertCleanGitPaths(result.changes);
  const { validateStagedChanges } = await import('./proposal-validator');
  const stagedError = validateStagedChanges(result.changes);
  if (stagedError) throw new Error(`staged registry validation failed: ${stagedError}`);
  if (process.env.GRANTS_WATCH_NO_GIT === '1') {
    await recordPreparedChangeIntent(result, message, p.id);
  }
  let writeCompleted = false;
  try {
    writePreparedChanges(result);
    writeCompleted = true;
    if (result.changes.length > 0) invalidateRegistryCache();
    const commit =
      process.env.GRANTS_WATCH_NO_GIT === '1'
        ? null
        : await commitChange(
            result.changes.map((change) => change.path),
            message,
            p.id,
            result.changes,
            { fallbackState: 'prepared' }
          );
    return { ...result, commit };
  } catch (error) {
    if (error instanceof RegistryMutationError) throw error;
    if (writeCompleted) {
      throw new RegistryMutationError(
        `registry changed but approval handoff did not finish: ${error instanceof Error ? error.message : String(error)}`,
        true,
        error
      );
    }
    throw error;
  }
}

/** Writes buildProposalChanges' output to disk. Invalidates the in-memory
 *  registry cache on success so the running process reflects the write on
 *  its very next read, instead of waiting out the stale stamp window. */
export function applyProposal(p: Proposal): ApplyResult {
  const result = writeProposalChanges(p);
  if (result.changes.length > 0) invalidateRegistryCache();
  return result;
}

export function commitMessageFor(p: Proposal): string {
  const lines = [`${p.type}: ${p.title}`, ''];
  if (p.evidence_url) lines.push(`Source: ${p.evidence_url}`);
  lines.push(`Proposal: ${p.id}`);
  return lines.join('\n');
}

/** Best-effort local git commit, scoped to exactly the files passed in — never
 *  a blanket `registry/` add, so approving one Desk proposal can never sweep
 *  up unrelated local registry changes. Whenever no sha is produced — the
 *  GRANTS_WATCH_NO_GIT guard (Railway) or any git failure — the full change
 *  set (paths + post-write contents) is persisted durably via
 *  desk-store.recordAppliedChanges (Postgres when DATABASE_URL is set, else
 *  .data/pending-commits.jsonl) and this returns null; the file mutation
 *  already happened and is never rolled back. scripts/sync-desk-commits.mjs
 *  replays those ledger rows into real commits on a machine with git. */
export async function commitChange(
  files: string[],
  message: string,
  proposalId?: string | null,
  changes?: AppliedChange[],
  options: { recordFallback?: boolean; fallbackState?: 'prepared' | 'ready' } = {}
): Promise<string | null> {
  if (files.length === 0) return null;
  const ledger = () =>
    recordAppliedChanges(
      {
        proposal_id: proposalId ?? null,
        files: ledgerFilesFromChanges(files, changes),
        message,
      },
      options.fallbackState ?? 'ready'
    );
  if (process.env.GRANTS_WATCH_NO_GIT === '1') {
    if (options.recordFallback !== false) await ledger();
    return null;
  }
  try {
    assertGitBaseSnapshots(changes);
    execFileSync('git', ['add', '--', ...files], { cwd: REPO_ROOT, stdio: 'pipe' });
    execFileSync('git', ['commit', '--only', '-m', message, '--author', 'The Desk <desk@grants.watch>', '--', ...files], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, stdio: 'pipe' }).toString().trim();
  } catch {
    if (options.recordFallback !== false) await ledger();
    return null;
  }
}
