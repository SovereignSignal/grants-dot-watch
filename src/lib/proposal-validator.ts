// Deterministic, no-LLM validators for The Desk's machine-validation pipeline
// (docs/DESIGN.md's two-lane law, graduation clause). Each proposal type gets
// a fixed set of checks against live evidence + the registry itself; PASS
// means validation-runner.ts may apply + commit it without a human. This
// file never writes anything — buildProposalChanges' dry run is the only
// "write" it performs, and that's pure (computes, doesn't touch disk).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildProposalChanges } from './committer';
import { getOrg, loadRegistry } from './registry';
import type { Org, Proposal } from './types';
import { neverAutoReasonFor } from './machine-approval-policy';

const REPO_ROOT = process.cwd();
const REGISTRY = join(REPO_ROOT, 'registry');
const FETCH_TIMEOUT_MS = 10_000;

export interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface ValidationResult {
  pass: boolean;
  checks: CheckResult[];
  /** Present whenever pass is false — the single human-readable reason the
   *  Desk's exception queue shows. */
  reason?: string;
  /** True for classes that are never machine-validated by design (new_award,
   *  merge_orgs, anything unrecognized) — the Desk shows these as "needs the
   *  owner" rather than "machine check failed", since there was never a
   *  check to fail. */
  neverAuto?: boolean;
}

// ---- fetch ----

export interface FetchedPage {
  ok: boolean;
  status: number;
  finalUrl: string;
  text: string;
  error?: string;
}

/** 10s timeout, redirects followed (fetch's default), final URL + status +
 *  body text captured. Never throws — network/timeout/parse failures come
 *  back as ok:false with an error string, so a validator can always turn
 *  this into a check result. */
export async function fetchPage(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; grants-watch-validator/1.0; +https://grants.watch)',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    return { ok: res.ok, status: res.status, finalUrl: res.url || url, text };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      text: '',
      error: e instanceof Error ? e.message : 'fetch failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---- text matching ----

function stripDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** lowercase, strip diacritics, collapse anything non-alphanumeric to a
 *  single space. Applied identically to page text and to name/date strings
 *  so both sides of a fuzzy comparison land in the same shape. */
function normalizeForMatch(s: string): string {
  return stripDiacritics((s || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Fuzzy "is this name on the page": try the full normalized name first;
 *  failing that, require every distinctive token (>=5 chars, so "the",
 *  "fund", "labs" alone never carries it) to appear. If the name has no
 *  token that long, there's nothing safe to fall back to — false. */
export function nameOnPage(pageText: string, name: string): boolean {
  if (!name || !pageText) return false;
  const page = normalizeForMatch(pageText);
  const full = normalizeForMatch(name);
  if (!full) return false;
  if (page.includes(full)) return true;
  const tokens = [...new Set(full.split(' ').filter((t) => t.length >= 5))];
  if (tokens.length === 0) return false;
  return tokens.every((t) => page.includes(t));
}

// ---- date-variant matching ----

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Common ways a human-written page might render one ISO date: month names
 *  (full/abbreviated) in both orders, numeric MM/DD and DD/MM with and
 *  without zero-padding, dotted/slashed ISO order. Not exhaustive by
 *  design — a miss here means the proposal queues for Sov, which is the
 *  safe direction to fail in. */
function dateVariants(iso: string): string[] {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) return [iso];
  const [, y, mo, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
  const monthIdx = parseInt(mo, 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return [iso];
  const monthName = MONTHS[monthIdx];
  const monthAbbr = monthName.slice(0, 3);
  const dayNum = String(parseInt(d, 10));
  const moNum = String(parseInt(mo, 10));

  return [
    iso,
    `${monthAbbr} ${dayNum}`,
    `${monthName} ${dayNum}`,
    `${dayNum} ${monthAbbr}`,
    `${dayNum} ${monthName}`,
    `${monthAbbr} ${dayNum}, ${y}`,
    `${monthName} ${dayNum}, ${y}`,
    `${dayNum} ${monthAbbr} ${y}`,
    `${dayNum} ${monthName} ${y}`,
    `${mo}/${d}/${y}`,
    `${moNum}/${dayNum}/${y}`,
    `${mo}/${d}`,
    `${moNum}/${dayNum}`,
    `${d}/${mo}/${y}`,
    `${dayNum}/${moNum}/${y}`,
    `${y}/${mo}/${d}`,
    `${y}.${mo}.${d}`,
    `${y}-${moNum}-${dayNum}`,
  ];
}

export function pageContainsDate(pageText: string, iso: string): boolean {
  const page = normalizeForMatch(pageText);
  if (!page) return false;
  return dateVariants(iso).some((v) => {
    const nv = normalizeForMatch(v);
    return nv && page.includes(nv);
  });
}

/** Recursively pulls every ISO-shaped (`YYYY-MM-DD`) string literal out of a
 *  proposed_change tree — round `opens`/`closes`, or anything shaped that
 *  way regardless of key name. */
function findDateLiterals(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (ISO_DATE_RE.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) findDateLiterals(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) findDateLiterals(v, out);
  }
  return out;
}

// ---- org resolver dedupe (pattern reused from scripts/resolve-orgs.mjs) ----
// norm/domainOf/buildOrgDedupeIndex/findDuplicateOrg are exported so
// ingest.ts's resolver can match wire/discuss.watch items against the
// registry with the EXACT same normalization this validator's own
// not-a-duplicate check uses — one normalization rule, not two that could
// silently drift apart.

export function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function domainOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    const h = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return h.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

// Multi-tenant platform hostnames — an org's `socials.x`/`socials.github`/...
// value lives at a HANDLE under one of these shared domains, not at a domain
// the org owns. Found live (2026-07-11) while smoke-testing ingest.ts's org
// resolver: 142 registry orgs carry a socials.x pointing at x.com, so
// without this guard every org's byDomain entry for "x.com" collided on one
// winner (whichever org buildOrgDedupeIndex iterated first — alphabetically
// "1inch Network") and every x.com URL from ANY org resolved to that one
// org. domainOf() only ever looks at .hostname (never the path), so it
// cannot tell handles on a shared platform apart — the fix is to never let
// a shared-platform hostname enter the domain index at all, from either
// `website` or `socials`.
const SHARED_PLATFORM_DOMAINS = new Set([
  'x.com', 'twitter.com', 'github.com', 'discord.gg', 'discord.com',
  't.me', 'telegram.me', 'telegram.org', 'medium.com', 'mirror.xyz',
  'warpcast.com', 'farcaster.xyz', 'youtube.com', 'youtu.be', 'linkedin.com',
  'reddit.com', 'facebook.com', 'instagram.com', 'notion.site', 'linktr.ee',
  'substack.com', 'bsky.app', 'lens.xyz', 'tiktok.com',
]);

export interface OrgDedupeIndex {
  byName: Map<string, Org>;
  byDomain: Map<string, Org>;
}

export function buildOrgDedupeIndex(orgs: Org[]): OrgDedupeIndex {
  const byName = new Map<string, Org>();
  const byDomain = new Map<string, Org>();
  for (const o of orgs) {
    for (const n of [o.name, ...(o.aka || [])]) {
      const key = norm(n);
      if (key && !byName.has(key)) byName.set(key, o);
    }
    const socialUrls = o.socials ? Object.values(o.socials) : [];
    for (const url of [o.website, ...socialUrls]) {
      const d = domainOf(url);
      if (d && !SHARED_PLATFORM_DOMAINS.has(d) && !byDomain.has(d)) byDomain.set(d, o);
    }
  }
  return { byName, byDomain };
}

export function findDuplicateOrg(
  index: OrgDedupeIndex,
  candidate: { name?: string | null; aka?: string[]; website?: string | null }
): Org | null {
  const d = domainOf(candidate.website);
  if (d && index.byDomain.has(d)) return index.byDomain.get(d)!;
  for (const n of [candidate.name, ...(candidate.aka || [])]) {
    if (!n) continue;
    const key = norm(n);
    if (key && index.byName.has(key)) return index.byName.get(key)!;
  }
  return null;
}

// ---- shared small helpers ----

function fail(checks: CheckResult[], reason: string): ValidationResult {
  return { pass: false, checks, reason };
}

function tryDryRun(p: Proposal, checks: CheckResult[]): { ok: true } | { ok: false; result: ValidationResult } {
  try {
    const { changes } = buildProposalChanges(p);
    const ok = changes.length > 0;
    checks.push({ name: 'dry-run-builds', pass: ok, detail: ok ? undefined : 'no changes produced' });
    if (!ok) return { ok: false, result: fail(checks, 'dry run produced no changes') };
    return { ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    checks.push({ name: 'dry-run-builds', pass: false, detail });
    return { ok: false, result: fail(checks, `dry run failed to build changes: ${detail}`) };
  }
}

// ---- new_org ----

async function validateNewOrg(p: Proposal): Promise<ValidationResult> {
  const checks: CheckResult[] = [];
  const pc = (p.proposed_change || {}) as Record<string, unknown>;
  const orgEntries = Object.entries(pc).filter(([k]) => /^orgs\/(.+)\.yaml$/.test(k));
  const registryEntries = Object.entries(pc).filter(([k]) => /^(orgs|programs)\/(.+)\.yaml$/.test(k));

  if (orgEntries.length === 0) {
    checks.push({ name: 'has-org-entry', pass: false });
    return fail(checks, 'no orgs/<slug>.yaml entry in proposed_change');
  }

  const hasOneValidatedEntry = orgEntries.length === 1 && registryEntries.length === 1;
  checks.push({
    name: 'has-one-validated-registry-entry',
    pass: hasOneValidatedEntry,
    detail: `${orgEntries.length} org entries, ${registryEntries.length} total registry entries`,
  });
  if (!hasOneValidatedEntry) return fail(checks, 'multi-entry new org proposals require owner review');

  const [key, rawVal] = orgEntries[0];
  const slug = /^orgs\/(.+)\.yaml$/.exec(key)![1];
  const val = (rawVal || {}) as Record<string, unknown>;
  const name = (val.name as string) || p.org_name || null;
  const website = (val.website as string) || null;

  const hasNameAndWebsite = !!name && !!website;
  checks.push({
    name: 'name-and-website-present',
    pass: hasNameAndWebsite,
    detail: `name=${name ?? '(none)'} website=${website ?? '(none)'}`,
  });
  if (!hasNameAndWebsite) return fail(checks, 'missing org name or website');

  const badOrgValue = validateKnownValueFields(true, val);
  checks.push({ name: 'known-fields-hold-valid-values', pass: !badOrgValue, detail: badOrgValue });
  if (badOrgValue) return fail(checks, `invalid field value: ${badOrgValue}`);

  const page = await fetchPage(website!);
  checks.push({
    name: 'website-fetches-200',
    pass: page.ok,
    detail: page.error ? page.error : `status ${page.status} @ ${page.finalUrl}`,
  });
  if (!page.ok) return fail(checks, `website did not return 200 (status ${page.status}${page.error ? `, ${page.error}` : ''})`);

  const nameMatch = nameOnPage(page.text, name!);
  checks.push({ name: 'page-contains-org-name', pass: nameMatch });
  if (!nameMatch) return fail(checks, 'org name not found on its own website');

  const { orgs } = loadRegistry();
  const index = buildOrgDedupeIndex(orgs);
  const fileAlreadyExists = existsSync(join(REGISTRY, 'orgs', `${slug}.yaml`));
  const dupe = fileAlreadyExists ? null : findDuplicateOrg(index, { name, aka: val.aka as string[] | undefined, website });
  const isDupe = fileAlreadyExists || !!dupe;
  checks.push({
    name: 'not-a-duplicate',
    pass: !isDupe,
    detail: fileAlreadyExists ? `orgs/${slug}.yaml already exists` : dupe ? `matches existing org "${dupe.id}"` : undefined,
  });
  if (isDupe) return fail(checks, 'looks like a duplicate of an existing org');

  const dryRun = tryDryRun(p, checks);
  if (!dryRun.ok) return dryRun.result;

  return { pass: true, checks };
}

// ---- new_program ----

async function validateNewProgram(p: Proposal): Promise<ValidationResult> {
  const checks: CheckResult[] = [];
  const pc = (p.proposed_change || {}) as Record<string, unknown>;
  const programEntries = Object.entries(pc).filter(([k]) => /^programs\/(.+)\.yaml$/.test(k));

  if (programEntries.length === 0) {
    checks.push({ name: 'has-program-entry', pass: false });
    return fail(checks, 'no programs/<slug>.yaml entry in proposed_change');
  }

  const [key, rawVal] = programEntries[0];
  const slug = /^programs\/(.+)\.yaml$/.exec(key)![1];
  const val = (rawVal || {}) as Record<string, unknown>;
  const programName = p.program || (val.name as string) || null;
  const orgId = (val.org as string) || p.org || null;

  const hasNameAndOrg = !!programName && !!orgId;
  checks.push({
    name: 'program-name-and-org-present',
    pass: hasNameAndOrg,
    detail: `program=${programName ?? '(none)'} org=${orgId ?? '(none)'}`,
  });
  if (!hasNameAndOrg) return fail(checks, 'missing program name or org');

  const org = getOrg(orgId!);
  checks.push({ name: 'org-exists-in-registry', pass: !!org, detail: org ? org.name : `"${orgId}" not found` });
  if (!org) return fail(checks, `org "${orgId}" is not in the registry`);

  const badProgramValue = validateKnownValueFields(false, val);
  checks.push({ name: 'known-fields-hold-valid-values', pass: !badProgramValue, detail: badProgramValue });
  if (badProgramValue) return fail(checks, `invalid field value: ${badProgramValue}`);

  const candidateUrls = [p.evidence_url, val.apply_url as string | undefined].filter((u): u is string => !!u);
  if (candidateUrls.length === 0) {
    checks.push({ name: 'evidence-or-apply-url-fetches-200', pass: false, detail: 'no evidence_url or apply_url' });
    return fail(checks, 'no evidence_url or apply_url to check');
  }

  let page: FetchedPage | null = null;
  for (const url of candidateUrls) {
    const attempt = await fetchPage(url);
    if (!page) page = attempt;
    if (attempt.ok) {
      page = attempt;
      break;
    }
  }
  checks.push({
    name: 'evidence-or-apply-url-fetches-200',
    pass: !!page?.ok,
    detail: page ? (page.error ?? `status ${page.status} @ ${page.finalUrl}`) : undefined,
  });
  if (!page || !page.ok) return fail(checks, `evidence/apply url did not return 200 (status ${page?.status ?? 0})`);

  const programNameMatch = nameOnPage(page.text, programName!);
  const orgNameMatch = nameOnPage(page.text, org.name);
  const orgDomain = domainOf(org.website);
  const pageDomain = domainOf(page.finalUrl);
  const onOrgDomain = !!orgDomain && !!pageDomain && (pageDomain === orgDomain || pageDomain.endsWith(`.${orgDomain}`));
  const orgSignal = orgNameMatch || onOrgDomain;

  checks.push({ name: 'page-contains-program-name', pass: programNameMatch });
  checks.push({
    name: 'page-contains-org-name-or-on-org-domain',
    pass: orgSignal,
    detail: onOrgDomain ? `page is on the org's own domain (${pageDomain})` : orgNameMatch ? 'org name found' : undefined,
  });
  if (!programNameMatch || !orgSignal) return fail(checks, 'program/org identity not confirmed on the evidence page');

  const fileAlreadyExists = existsSync(join(REGISTRY, 'programs', `${slug}.yaml`));
  checks.push({
    name: 'program-id-not-already-registered',
    pass: !fileAlreadyExists,
    detail: fileAlreadyExists ? `programs/${slug}.yaml already exists` : undefined,
  });
  if (fileAlreadyExists) return fail(checks, 'program id already exists in the registry');

  const dryRun = tryDryRun(p, checks);
  if (!dryRun.ok) return dryRun.result;

  return { pass: true, checks };
}

// ---- round_update / deadline_change / status_change ----

async function validateFactUpdate(p: Proposal): Promise<ValidationResult> {
  const checks: CheckResult[] = [];

  if (!p.evidence_url) {
    checks.push({ name: 'evidence-url-present', pass: false });
    return fail(checks, 'no evidence_url');
  }

  const page = await fetchPage(p.evidence_url);
  checks.push({
    name: 'evidence-fetches-200',
    pass: page.ok,
    detail: page.error ? page.error : `status ${page.status} @ ${page.finalUrl}`,
  });
  if (!page.ok) return fail(checks, `evidence url did not return 200 (status ${page.status}${page.error ? `, ${page.error}` : ''})`);

  const org = p.org ? getOrg(p.org) : null;
  const nameToCheck = p.program || org?.name || p.org_name || null;
  const nameMatch = nameToCheck ? nameOnPage(page.text, nameToCheck) : false;
  checks.push({ name: 'page-contains-program-or-org-name', pass: nameMatch, detail: nameToCheck ?? '(none)' });
  if (!nameMatch) return fail(checks, 'program/org name not found on the evidence page');

  const literals = [...new Set(findDateLiterals(p.proposed_change))];
  if (literals.length === 0) {
    checks.push({ name: 'has-checkable-literal', pass: false });
    return fail(checks, 'no machine-checkable claim');
  }
  checks.push({ name: 'has-checkable-literal', pass: true, detail: literals.join(', ') });

  // Recency rule: a claim whose every date is already in the past is history,
  // not an actionable update — the committer would auto-close it anyway, and
  // approving it as "open" is how years-old rounds ended up on the front page.
  const todayISO = new Date().toISOString().slice(0, 10);
  const allPast = literals.every((d) => d < todayISO);
  checks.push({ name: 'claim-is-current', pass: !allPast, detail: allPast ? `all dates before ${todayISO}` : 'has future/current dates' });
  if (allPast) return fail(checks, 'deadline already passed: historical, not actionable');

  const unmatched = literals.filter((d) => !pageContainsDate(page.text, d));
  const allMatch = unmatched.length === 0;
  checks.push({
    name: 'page-contains-claimed-date',
    pass: allMatch,
    detail: allMatch ? literals.join(', ') : `not found on page: ${unmatched.join(', ')}`,
  });
  if (!allMatch) return fail(checks, 'claimed date not found on the evidence page');

  const dryRun = tryDryRun(p, checks);
  if (!dryRun.ok) return dryRun.result;

  return { pass: true, checks };
}

// ---- new_award (deprioritized) ----

function validateNewAward(): ValidationResult {
  return {
    pass: false,
    checks: [{ name: 'awards-deprioritized', pass: false, detail: 'owner retreat: awards are manual-only for now' }],
    reason: 'awards deprioritized: manual only',
    neverAuto: true,
  };
}

// ---- profile_note ----

const PROFILE_NOTE_ORG_ALLOWED = new Set([
  'aka', 'systems', 'wires', 'roles', 'org_type', 'website', 'status', 'socials', 'funding', 'sources', 'sources_add',
]);
const PROFILE_NOTE_PROGRAM_ALLOWED = new Set([
  'parent', 'status', 'mechanism', 'apply_url', 'sources', 'sources_add', 'rounds', 'add_round',
]);

// Mirror registry/SCHEMA.md's enums (also enforced by scripts/validate-registry.mjs)
// — field-NAME allowlisting alone isn't enough proof a value is safe to write:
// an "identity" field like `website` or `status` can still carry garbage (a
// sentence instead of a URL, an enum value that isn't in the schema). Found
// live in this pipeline's own smoke test: a profile_note wrote
// `website: "(dead — 404 confirmed ...)"` and `status: closed` (not a valid
// org status) onto an existing org, and the field-name check alone would
// have waved both through.
const ORG_STATUS_VALUES = new Set(['active', 'winding-down', 'dormant', 'unknown']);
const ORG_TYPE_VALUES = new Set(['foundation', 'dao', 'company', 'nonprofit', 'government', 'education']);
const ORG_ROLE_VALUES = new Set(['funder', 'grantee', 'ecosystem']);
const PROGRAM_STATUS_VALUES = new Set(['active', 'paused', 'concluded', 'announced', 'unknown']);
const MECHANISM_VALUES = new Set(['grants', 'retro', 'quadratic', 'prize', 'fellowship', 'incubator', 'rfp', 'other']);
const WIRE_VALUES = new Set(['crypto', 'ai', 'oss']);
const ROUND_STATUS_VALUES = new Set(['announced', 'open', 'reviewing', 'closed', 'deployed']);

function isUrlLike(v: unknown): boolean {
  return typeof v === 'string' && /^https?:\/\/\S+$/.test(v);
}

/** Value-level sanity for one (field, value) pair inside a profile_note field
 *  map — returns a human reason on failure, undefined on pass. Deliberately
 *  narrow: only fields with a known shape/enum get checked; free-text arrays
 *  (aka, sources) and the loosely-shaped `funding` object pass through
 *  unchecked, same as before. */
function invalidFieldValueReason(isOrg: boolean, field: string, value: unknown): string | undefined {
  if (field === 'website' || field === 'apply_url') {
    return isUrlLike(value) ? undefined : `${field} is not a URL: "${String(value).slice(0, 80)}"`;
  }
  if (field === 'status') {
    const allowed = isOrg ? ORG_STATUS_VALUES : PROGRAM_STATUS_VALUES;
    return allowed.has(value as string) ? undefined : `status "${String(value)}" is not a valid ${isOrg ? 'org' : 'program'} status`;
  }
  if (field === 'org_type') {
    return ORG_TYPE_VALUES.has(value as string) ? undefined : `org_type "${String(value)}" is not valid`;
  }
  if (field === 'roles') {
    const ok = Array.isArray(value) && value.length > 0 && value.every((r) => ORG_ROLE_VALUES.has(r as string));
    return ok ? undefined : `roles ${JSON.stringify(value)} is invalid`;
  }
  if (field === 'wires') {
    const ok = Array.isArray(value) && value.every((w) => WIRE_VALUES.has(w as string));
    return ok ? undefined : `wires ${JSON.stringify(value)} is invalid`;
  }
  if (field === 'mechanism') {
    return MECHANISM_VALUES.has(value as string) ? undefined : `mechanism "${String(value)}" is not valid`;
  }
  if (field === 'socials' && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!isUrlLike(v)) return `socials.${k} is not a URL: "${String(v).slice(0, 80)}"`;
    }
    return undefined;
  }
  if (field === 'rounds' || field === 'add_round') {
    const rounds = Array.isArray(value) ? value : [value];
    for (const r of rounds) {
      if (r && typeof r === 'object' && 'status' in (r as Record<string, unknown>)) {
        const s = (r as Record<string, unknown>).status;
        if (!ROUND_STATUS_VALUES.has(s as string)) return `round status "${String(s)}" is not valid`;
      }
    }
    return undefined;
  }
  return undefined;
}

/** Same value-sanity pass as profile_note's, reused by new_org/new_program
 *  for the handful of enum/URL-shaped fields a miner-drafted proposal might
 *  carry directly (roles, wires, status, org_type, mechanism, socials) —
 *  the same "a field can have the right name and a garbage value" risk
 *  applies there too, it's just less common since those proposals are
 *  usually simpler than an editorial profile_note. */
function validateKnownValueFields(isOrg: boolean, val: Record<string, unknown>): string | undefined {
  const fieldsToCheck = isOrg ? ['status', 'org_type', 'roles', 'wires', 'socials'] : ['status', 'mechanism', 'apply_url', 'rounds'];
  for (const field of fieldsToCheck) {
    if (!(field in val)) continue;
    const reason = invalidFieldValueReason(isOrg, field, val[field]);
    if (reason) return `${field}: ${reason}`;
  }
  return undefined;
}

/** Whether a profile_note's field map touches only identity/funding/socials
 *  fields, with values that hold their declared shape — never prose
 *  (`profile`, `profile_update`, `summary*`, `name`), never the
 *  advisory/destructive `action`/`remove` keys, and never a field-name match
 *  hiding a bad value. The literal top-level `{ profile: "<text>" }` shape
 *  (proposal-lanes shape (1), committer.ts's original behavior) is prose by
 *  construction — not allowed. */
function profileNoteFieldsAllowed(pc: Record<string, unknown>): { allowed: boolean; touched: string[]; badValue?: string } {
  const fileEntries = Object.entries(pc).filter(
    ([k, v]) => /^(orgs|programs)\/.+\.yaml$/.test(k) && v != null && typeof v === 'object'
  );
  if (fileEntries.length === 0) return { allowed: false, touched: [] };

  const touched: string[] = [];
  for (const [key, value] of fileEntries) {
    const isOrg = key.startsWith('orgs/');
    const allowedSet = isOrg ? PROFILE_NOTE_ORG_ALLOWED : PROFILE_NOTE_PROGRAM_ALLOWED;
    for (const [field, fieldValue] of Object.entries(value as Record<string, unknown>)) {
      if (field === 'id') continue;
      touched.push(field);
      if (!allowedSet.has(field)) return { allowed: false, touched };
      const badValue = invalidFieldValueReason(isOrg, field, fieldValue);
      if (badValue) return { allowed: false, touched, badValue: `${key} ${field}: ${badValue}` };
    }
  }
  if (typeof pc.action === 'string' || typeof pc.remove === 'string') return { allowed: false, touched };
  return { allowed: true, touched };
}

async function validateProfileNote(p: Proposal): Promise<ValidationResult> {
  const checks: CheckResult[] = [];
  const pc = (p.proposed_change || {}) as Record<string, unknown>;

  const { allowed, touched, badValue } = profileNoteFieldsAllowed(pc);
  checks.push({
    name: 'fields-are-identity-funding-socials-only',
    pass: allowed,
    detail: badValue || (touched.length ? touched.join(', ') : '(no field-keyed changes)'),
  });
  if (!allowed) return fail(checks, badValue ? `invalid field value: ${badValue}` : 'editorial: needs the owner');

  if (!p.evidence_url) {
    checks.push({ name: 'evidence-url-present', pass: false });
    return fail(checks, 'no evidence_url');
  }
  const page = await fetchPage(p.evidence_url);
  checks.push({
    name: 'evidence-fetches-200',
    pass: page.ok,
    detail: page.error ? page.error : `status ${page.status} @ ${page.finalUrl}`,
  });
  if (!page.ok) return fail(checks, `evidence url did not return 200 (status ${page.status}${page.error ? `, ${page.error}` : ''})`);

  const dryRun = tryDryRun(p, checks);
  if (!dryRun.ok) return dryRun.result;

  return { pass: true, checks };
}

// ---- merge_orgs + anything unrecognized: never auto ----

function neverAuto(detail: string): ValidationResult {
  return {
    pass: false,
    checks: [{ name: 'never-auto-class', pass: false, detail }],
    reason: 'never auto',
    neverAuto: true,
  };
}

// ---- dispatcher ----

/** Runs the deterministic check set for one proposal's type. Never throws —
 *  every branch that can fail (network, missing data, a bad dry run) is
 *  caught locally and turned into a FAIL with a reason; validation-runner.ts
 *  still wraps the call defensively, but this function's own contract is
 *  "always resolves to a ValidationResult." */
export async function validateProposal(p: Proposal): Promise<ValidationResult> {
  const neverAutoReason = neverAutoReasonFor(p.type);
  if (neverAutoReason) return neverAuto(neverAutoReason);

  switch (p.type) {
    case 'new_org':
      return validateNewOrg(p);
    case 'new_program':
      return neverAuto('new programs require owner review');
    case 'round_update':
    case 'deadline_change':
    case 'status_change':
      return validateFactUpdate(p);
    case 'new_award':
      return validateNewAward();
    case 'profile_note':
      return validateProfileNote(p);
    case 'merge_orgs':
      return neverAuto('org merges are never automated');
    default:
      return neverAuto(`unrecognized proposal type "${p.type as string}"`);
  }
}
