// Deterministic, no-LLM validators for The Desk's machine-validation pipeline
// (docs/DESIGN.md's two-lane law, graduation clause). Each proposal type gets
// a fixed set of checks against live evidence + the registry itself; PASS
// means validation-runner.ts may apply + commit it without a human. This
// file never touches the canonical registry. Dry-run changes are copied into
// a disposable staging directory for full schema/reference validation.
import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { buildProposalChanges } from './committer';
import { getOrg, loadRegistry } from './registry';
import { productDateISO } from './round-state';
import type { Org, Proposal } from './types';
import { neverAutoReasonFor } from './machine-approval-policy';

const REPO_ROOT = process.cwd();
const REGISTRY = join(REPO_ROOT, 'registry');
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_MAX_BYTES = 2 * 1024 * 1024;
const FETCH_MAX_REDIRECTS = 5;
const ALLOWED_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain', 'application/xml', 'text/xml']);
const DEFAULT_TRUSTED_EVIDENCE_DOMAINS = new Set(['grants.gov']);

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
  /** True for classes that are owner-only by design, plus anything
   * unrecognized. Desk presents these as "needs the owner." */
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

interface LookupAddress {
  address: string;
  family: number;
}

export interface FetchPageDependencies {
  /** Test seam. Production callers use Node's DNS resolver. */
  lookupImpl?: (hostname: string) => Promise<LookupAddress[]>;
  /** Test seam. Production callers use the platform fetch implementation. */
  fetchImpl?: typeof fetch;
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isBlockedIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv6ToBigInt(address: string): bigint | null {
  let input = address.toLowerCase().split('%')[0];
  const ipv4Tail = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(input);
  if (ipv4Tail) {
    const parts = ipv4Parts(ipv4Tail[1]);
    if (!parts) return null;
    const high = ((parts[0] << 8) | parts[1]).toString(16);
    const low = ((parts[2] << 8) | parts[3]).toString(16);
    input = `${input.slice(0, input.length - ipv4Tail[1].length)}${high}:${low}`;
  }

  const sides = input.split('::');
  if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(':') : [];
  const right = sides.length === 2 && sides[1] ? sides[1].split(':') : [];
  if (sides.length === 1 && left.length !== 8) return null;
  const zeros = sides.length === 2 ? 8 - left.length - right.length : 0;
  if (zeros < 1 && sides.length === 2) return null;
  const groups = [...left, ...Array.from({ length: zeros }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function isBlockedIpv6(address: string): boolean {
  const value = ipv6ToBigInt(address);
  if (value == null) return true;
  if (value === 0n || value === 1n) return true; // unspecified and loopback
  if ((value >> 121n) === 0x7en) return true; // fc00::/7 unique-local
  if ((value >> 118n) === 0x3fan) return true; // fe80::/10 link-local
  if ((value >> 120n) === 0xffn) return true; // multicast
  if ((value >> 32n) === 0n) return true; // IPv4-compatible and other reserved ::/96 forms
  // IPv4-mapped IPv6 (::ffff:0:0/96) inherits the IPv4 restrictions.
  if ((value >> 32n) === 0xffffn) {
    const low = Number(value & 0xffffffffn);
    return isBlockedIpv4(`${(low >>> 24) & 255}.${(low >>> 16) & 255}.${(low >>> 8) & 255}.${low & 255}`);
  }
  return false;
}

export function isBlockedNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

async function assertPublicDestination(url: URL, deps: FetchPageDependencies): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http(s) evidence URLs are allowed');
  if (url.username || url.password) throw new Error('evidence URLs with embedded credentials are not allowed');

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('localhost evidence destinations are blocked');
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await (deps.lookupImpl ?? (async (host) => lookup(host, { all: true, verbatim: true })))(hostname);
  if (addresses.length === 0) throw new Error('evidence hostname resolved to no addresses');
  const blocked = addresses.find(({ address }) => isBlockedNetworkAddress(address));
  if (blocked) throw new Error(`private, local, or link-local evidence destination blocked (${blocked.address})`);
}

function redirectLocation(response: Response, currentUrl: URL): URL | null {
  if (![301, 302, 303, 307, 308].includes(response.status)) return null;
  const location = response.headers.get('location');
  if (!location) throw new Error(`redirect response ${response.status} had no Location header`);
  return new URL(location, currentUrl);
}

async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`evidence response exceeded ${maxBytes} bytes`);
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('response too large');
      throw new Error(`evidence response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

/** Fail-closed evidence fetcher. Every request and redirect target is DNS
 * checked before fetch; response type and size are bounded. Never throws to
 * callers: all failures become ok:false so the proposal stays in Desk. */
export async function fetchPage(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
  deps: FetchPageDependencies = {}
): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let current = url;
  try {
    const fetchImpl = deps.fetchImpl ?? fetch;
    for (let redirects = 0; redirects <= FETCH_MAX_REDIRECTS; redirects++) {
      const parsed = new URL(current);
      await assertPublicDestination(parsed, deps);
      const res = await fetchImpl(parsed, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; grants-watch-validator/1.0; +https://grants.watch)',
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/xml;q=0.8',
        },
      });

      const next = redirectLocation(res, parsed);
      if (next) {
        if (redirects === FETCH_MAX_REDIRECTS) throw new Error(`more than ${FETCH_MAX_REDIRECTS} evidence redirects`);
        await assertPublicDestination(next, deps);
        await res.body?.cancel();
        current = next.toString();
        continue;
      }

      // Some fetch implementations expose a different final URL even in
      // manual mode. Apply the same destination guard before accepting it.
      const finalUrl = res.url || parsed.toString();
      await assertPublicDestination(new URL(finalUrl), deps);
      const mediaType = (res.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(mediaType)) {
        throw new Error(`unsupported evidence content type "${mediaType || '(missing)'}"`);
      }
      const text = await readCappedText(res, FETCH_MAX_BYTES);
      return { ok: res.ok, status: res.status, finalUrl, text };
    }
    throw new Error(`more than ${FETCH_MAX_REDIRECTS} evidence redirects`);
  } catch (e) {
    return {
      ok: false,
      status: 0,
      finalUrl: current,
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
  const visibleText = (s || '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, ' ');
  return stripDiacritics(visibleText.toLowerCase())
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

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Common year-bearing ways a human-written page might render one exact ISO
 * date. Month/day-only variants are deliberately excluded: they let a stale
 * or wrong-year page approve a current claim. */
function dateVariants(iso: string): string[] {
  if (!isValidIsoDate(iso)) return [];
  const [, y, mo, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
  const monthIdx = parseInt(mo, 10) - 1;
  const monthName = MONTHS[monthIdx];
  const monthAbbr = monthName.slice(0, 3);
  const dayNum = String(parseInt(d, 10));

  return [
    iso,
    `${monthAbbr} ${dayNum}, ${y}`,
    `${monthName} ${dayNum}, ${y}`,
    `${dayNum} ${monthAbbr} ${y}`,
    `${dayNum} ${monthName} ${y}`,
    `${y}/${mo}/${d}`,
    `${y}.${mo}.${d}`,
  ];
}

export function pageContainsDate(pageText: string, iso: string): boolean {
  const page = normalizeForMatch(pageText);
  if (!page || !isValidIsoDate(iso)) return false;
  return dateVariants(iso).some((v) => {
    const nv = normalizeForMatch(v);
    return nv && ` ${page} `.includes(` ${nv} `);
  });
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

function domainMatches(hostname: string, allowedDomain: string): boolean {
  return hostname === allowedDomain || hostname.endsWith(`.${allowedDomain}`);
}

function configuredTrustedEvidenceDomains(): Set<string> {
  const configured = (process.env.GRANTS_WATCH_TRUSTED_EVIDENCE_DOMAINS || '')
    .split(',')
    .map((value) => domainOf(value.trim()) || value.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
  return new Set([...DEFAULT_TRUSTED_EVIDENCE_DOMAINS, ...configured]);
}

/** A fact may auto-apply only from the target organization's own web domain
 * or from a domain explicitly trusted in code/config. Matching includes
 * subdomains but never sibling or lookalike domains. */
export function isAuthoritativeEvidenceUrl(
  evidenceUrl: string,
  org: Org | null,
  trustedDomains: Iterable<string> = configuredTrustedEvidenceDomains()
): boolean {
  const evidenceDomain = domainOf(evidenceUrl);
  if (!evidenceDomain) return false;
  const orgDomain = domainOf(org?.website);
  if (orgDomain && !SHARED_PLATFORM_DOMAINS.has(orgDomain) && domainMatches(evidenceDomain, orgDomain)) return true;
  for (const raw of trustedDomains) {
    const trusted = domainOf(raw) || raw.toLowerCase().replace(/^\.+|\.+$/g, '');
    if (trusted && domainMatches(evidenceDomain, trusted)) return true;
  }
  return false;
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

function processOutput(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const withStderr = error as Error & { stderr?: Buffer | string; stdout?: Buffer | string };
  return withStderr.stderr?.toString() || withStderr.stdout?.toString() || error.message;
}

function conciseProcessError(error: unknown, targetPaths: string[] = []): string {
  const raw = processOutput(error);
  const targets = targetPaths.map(path => path.replace(/^registry\//, '') + ':');
  // Show errors on the proposed files before unrelated registry findings.
  // Otherwise the size bound can hide the correction the reviewer must make.
  const lines = raw.split('\n').sort((a, b) =>
    Number(targets.some(path => b.startsWith(path))) - Number(targets.some(path => a.startsWith(path)))
  );
  return lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600);
}

/** An approve fails only for validator findings on the files it writes.
 *  A past-due round in some other program must not block the desk. */
export function blockingStagedError(output: string, touchedPaths: string[]): string | null {
  const touched = new Set(touchedPaths.map((path) => path.replace(/^registry\//, '')));
  const relevant = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.startsWith('FAIL:') || line.startsWith('...and ')) return false;
      for (const file of touched) {
        if (line.startsWith(`${file}:`)) return true;
      }
      return false;
    });
  if (relevant.length === 0) return null;
  return relevant.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600);
}

function unrelatedRegistryFindings(output: string): boolean {
  return output.split('\n').some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('FAIL:') || /^(?:systems|orgs|programs|awards)\//.test(trimmed);
  });
}

/** Applies a pure change set to an isolated copy of registry/ and runs the
 * canonical validator there. This catches schema, reference, duplicate,
 * date, and membrane violations before the live registry is touched. */
export function validateStagedChanges(changes: ReturnType<typeof buildProposalChanges>['changes']): string | null {
  const dataDir = join(REPO_ROOT, '.data');
  mkdirSync(dataDir, { recursive: true });
  const stageRoot = mkdtempSync(join(dataDir, 'validation-stage-'));
  try {
    const stageRegistry = join(stageRoot, 'registry');
    const stageScripts = join(stageRoot, 'scripts');
    cpSync(REGISTRY, stageRegistry, { recursive: true });
    mkdirSync(stageScripts, { recursive: true });
    copyFileSync(join(REPO_ROOT, 'scripts', 'validate-registry.mjs'), join(stageScripts, 'validate-registry.mjs'));

    for (const change of changes) {
      const destination = resolve(stageRoot, change.path);
      const registryRelative = relative(stageRegistry, destination);
      if (registryRelative.startsWith('..') || registryRelative === '') {
        throw new Error(`change path escapes staged registry: ${change.path}`);
      }
      mkdirSync(dirname(destination), { recursive: true });
      if (change.op === 'append') appendFileSync(destination, change.content, 'utf8');
      else writeFileSync(destination, change.content, 'utf8');
    }

    execFileSync(process.execPath, [join(stageScripts, 'validate-registry.mjs')], {
      cwd: stageRoot,
      encoding: 'utf8',
      env: { ...process.env, VALIDATION_TODAY: productDateISO() },
      stdio: 'pipe',
    });
    return null;
  } catch (error) {
    const raw = processOutput(error);
    const blocking = blockingStagedError(raw, changes.map((change) => change.path));
    if (blocking) return blocking;
    // Pre-existing findings in files this approve does not write are not this item's problem.
    if (unrelatedRegistryFindings(raw)) return null;
    return conciseProcessError(error, changes.map(change => change.path));
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

function tryDryRun(p: Proposal, checks: CheckResult[]): { ok: true } | { ok: false; result: ValidationResult } {
  try {
    const { changes } = buildProposalChanges(p);
    const ok = changes.length > 0;
    checks.push({ name: 'dry-run-builds', pass: ok, detail: ok ? undefined : 'no changes produced' });
    if (!ok) return { ok: false, result: fail(checks, 'dry run produced no changes') };

    const stagedError = validateStagedChanges(changes);
    checks.push({ name: 'staged-registry-valid', pass: !stagedError, detail: stagedError || undefined });
    if (stagedError) return { ok: false, result: fail(checks, `staged registry validation failed: ${stagedError}`) };
    return { ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    checks.push({ name: 'dry-run-builds', pass: false, detail });
    return { ok: false, result: fail(checks, `dry run failed to build changes: ${detail}`) };
  }
}

// ---- round_update / deadline_change ----

const FACT_PATCH_FIELDS = new Set(['rounds']);
const ROUND_PATCH_FIELDS = new Set(['name', 'status', 'opens', 'closes', 'size', 'source']);
const FACT_ROUND_STATUSES = new Set(['announced', 'open', 'reviewing', 'closed', 'deployed']);
const STATUS_EVIDENCE_PHRASES: Record<string, string[]> = {
  announced: ['announced', 'coming soon', 'launching', 'opens on'],
  open: ['applications open', 'applications are open', 'submissions open', 'now open', 'open call', 'apply now', 'accepting applications'],
  reviewing: ['under review', 'reviewing applications', 'applications are being reviewed', 'selection in progress'],
  closed: ['applications closed', 'applications are closed', 'submissions closed', 'now closed', 'call closed', 'deadline has passed'],
  deployed: ['awarded', 'funded projects', 'selected projects', 'funds distributed', 'recipients announced'],
};

export function pageContainsLiteralClaim(pageText: string, value: string | number): boolean {
  const page = normalizeForMatch(pageText);
  const claim = normalizeForMatch(String(value));
  return !!page && !!claim && ` ${page} `.includes(` ${claim} `);
}

export function pageContainsStatusClaim(pageText: string, status: string): boolean {
  const phrases = STATUS_EVIDENCE_PHRASES[status] || [];
  return phrases.some((phrase) => pageContainsLiteralClaim(pageText, phrase));
}

interface FactPatch {
  targetProgramId: string;
  patch: Record<string, unknown>;
  rounds: Record<string, unknown>[];
  dates: string[];
}

function parseFactPatch(p: Proposal): { value?: FactPatch; error?: string } {
  const proposed = (p.proposed_change || {}) as Record<string, unknown>;
  const programEntries = Object.entries(proposed).filter(
    ([key, value]) => /^programs\/(.+)\.yaml$/.test(key) && value != null && typeof value === 'object' && !Array.isArray(value)
  );
  const orgEntries = Object.keys(proposed).filter((key) => /^orgs\/(.+)\.yaml$/.test(key));
  if (orgEntries.length) return { error: 'fact auto-approval cannot mutate organization files' };
  if (programEntries.length !== 1 || Object.keys(proposed).length !== 1) {
    return { error: 'fact auto-approval requires exactly one explicit programs/<id>.yaml target' };
  }

  const [targetKey, rawPatch] = programEntries[0];
  const targetProgramId = /^programs\/(.+)\.yaml$/.exec(targetKey)![1];
  const patch = rawPatch as Record<string, unknown>;
  const unsupported = Object.keys(patch).filter((field) => !FACT_PATCH_FIELDS.has(field));
  if (unsupported.length) return { error: `unsupported auto-fact fields: ${unsupported.join(', ')}` };
  if (!Array.isArray(patch.rounds) || patch.rounds.length === 0) return { error: 'fact update has no round changes' };

  const rounds: Record<string, unknown>[] = [];
  const dates: string[] = [];
  let materialClaims = 0;
  for (const [index, rawRound] of patch.rounds.entries()) {
    if (!rawRound || typeof rawRound !== 'object' || Array.isArray(rawRound)) {
      return { error: `round ${index + 1} is not an object` };
    }
    const round = rawRound as Record<string, unknown>;
    const badFields = Object.keys(round).filter((field) => !ROUND_PATCH_FIELDS.has(field));
    if (badFields.length) return { error: `round ${index + 1} has unsupported fields: ${badFields.join(', ')}` };
    if (typeof round.name !== 'string' || !round.name.trim()) return { error: `round ${index + 1} has no name` };
    if (round.status !== undefined && (typeof round.status !== 'string' || !FACT_ROUND_STATUSES.has(round.status))) {
      return { error: `round ${index + 1} has invalid status "${String(round.status)}"` };
    }
    if (round.status !== undefined) materialClaims++;
    if (round.size !== undefined && (typeof round.size !== 'string' || !round.size.trim())) {
      return { error: `round ${index + 1} has an invalid size claim` };
    }
    if (round.size !== undefined) materialClaims++;
    for (const field of ['opens', 'closes'] as const) {
      if (round[field] === undefined) continue;
      if (typeof round[field] !== 'string' || !isValidIsoDate(round[field])) {
        return { error: `round ${index + 1} has invalid ${field} date "${String(round[field])}"` };
      }
      dates.push(round[field]);
      materialClaims++;
    }
    if (round.source !== undefined && !isUrlLike(round.source)) {
      return { error: `round ${index + 1} has an invalid source URL` };
    }
    rounds.push(round);
  }
  if (p.type === 'deadline_change' && dates.length === 0) return { error: 'deadline change has no exact calendar date' };
  if (materialClaims === 0) return { error: 'round update has no machine-checkable status, date, or size claim' };
  return { value: { targetProgramId, patch, rounds, dates: [...new Set(dates)] } };
}

function sameUrl(left: string, right: string): boolean {
  try {
    const normalize = (raw: string) => {
      const parsed = new URL(raw);
      parsed.hash = '';
      return parsed.toString().replace(/\/$/, '');
    };
    return normalize(left) === normalize(right);
  } catch {
    return false;
  }
}

function pageLinksTo(pageText: string, url: string): boolean {
  const decoded = pageText.replace(/&amp;/gi, '&');
  return decoded.includes(url) || decoded.includes(url.replace(/\/$/, ''));
}

async function validateFactUpdate(p: Proposal): Promise<ValidationResult> {
  const checks: CheckResult[] = [];
  const parsedPatch = parseFactPatch(p);
  checks.push({ name: 'fact-patch-shape-safe', pass: !!parsedPatch.value, detail: parsedPatch.error });
  if (!parsedPatch.value) return fail(checks, parsedPatch.error || 'invalid fact patch');
  const { targetProgramId, rounds, dates } = parsedPatch.value;

  const registry = loadRegistry();
  const targetProgram = registry.programs.find((program) => program.id === targetProgramId) || null;
  checks.push({ name: 'target-program-exists', pass: !!targetProgram, detail: targetProgramId });
  if (!targetProgram) return fail(checks, `program "${targetProgramId}" is not in the registry`);
  if (p.org && p.org !== targetProgram.org) {
    checks.push({ name: 'proposal-org-matches-target', pass: false, detail: `${p.org} != ${targetProgram.org}` });
    return fail(checks, 'proposal org does not own the target program');
  }
  for (const round of rounds) {
    const existing = targetProgram.rounds.some(
      (candidate) => normalizeForMatch(candidate.name) === normalizeForMatch(String(round.name))
    );
    if (!existing && typeof round.status !== 'string') {
      checks.push({ name: 'new-round-status-explicit', pass: false, detail: String(round.name) });
      return fail(checks, `new round "${String(round.name)}" requires an explicit evidenced status`);
    }
  }

  if (!p.evidence_url) {
    checks.push({ name: 'evidence-url-present', pass: false });
    return fail(checks, 'no evidence_url');
  }
  const org = getOrg(targetProgram.org);
  const initialAuthority = isAuthoritativeEvidenceUrl(p.evidence_url, org);
  checks.push({
    name: 'evidence-domain-authoritative',
    pass: initialAuthority,
    detail: initialAuthority ? domainOf(p.evidence_url) || undefined : `${domainOf(p.evidence_url) || '(invalid)'} is not owned/trusted`,
  });
  if (!initialAuthority) return fail(checks, 'evidence is not on the target organization or a trusted domain');

  const page = await fetchPage(p.evidence_url);
  checks.push({
    name: 'evidence-fetches-safe-200',
    pass: page.ok,
    detail: page.error ? page.error : `status ${page.status} @ ${page.finalUrl}`,
  });
  if (!page.ok) return fail(checks, `evidence url did not return a safe 200 (${page.error || `status ${page.status}`})`);

  const finalAuthority = isAuthoritativeEvidenceUrl(page.finalUrl, org);
  checks.push({ name: 'final-evidence-domain-authoritative', pass: finalAuthority, detail: domainOf(page.finalUrl) || '(invalid)' });
  if (!finalAuthority) return fail(checks, 'evidence redirected away from the target organization or trusted domain');

  const nameMatch = pageContainsLiteralClaim(page.text, targetProgram.name);
  checks.push({ name: 'page-contains-target-program-name', pass: nameMatch, detail: targetProgram.name });
  if (!nameMatch) return fail(checks, 'target program name not found on the evidence page');

  const todayISO = productDateISO();
  const allPast = dates.length > 0 && dates.every((date) => date < todayISO);
  checks.push({ name: 'claim-is-current', pass: !allPast, detail: allPast ? `all dates before ${todayISO}` : 'current, future, or undated' });
  if (allPast) return fail(checks, 'deadline already passed: historical, not actionable');

  for (const [index, round] of rounds.entries()) {
    const nameSupported = pageContainsLiteralClaim(page.text, round.name as string);
    checks.push({ name: `round-${index + 1}-name-supported`, pass: nameSupported, detail: String(round.name) });
    if (!nameSupported) return fail(checks, `round name "${String(round.name)}" not found on the evidence page`);

    if (typeof round.status === 'string') {
      const statusSupported = pageContainsStatusClaim(page.text, round.status);
      checks.push({ name: `round-${index + 1}-status-supported`, pass: statusSupported, detail: round.status });
      if (!statusSupported) return fail(checks, `round status "${round.status}" is not supported by the evidence page`);
    }
    for (const field of ['opens', 'closes'] as const) {
      if (typeof round[field] !== 'string') continue;
      const dateSupported = pageContainsDate(page.text, round[field]);
      checks.push({ name: `round-${index + 1}-${field}-supported`, pass: dateSupported, detail: round[field] });
      if (!dateSupported) return fail(checks, `claimed ${field} date ${round[field]} not found with its year on the evidence page`);
    }
    if (typeof round.size === 'string') {
      const sizeSupported = pageContainsLiteralClaim(page.text, round.size);
      checks.push({ name: `round-${index + 1}-size-supported`, pass: sizeSupported, detail: round.size });
      if (!sizeSupported) return fail(checks, `round size "${round.size}" is not supported by the evidence page`);
    }
    if (typeof round.source === 'string') {
      const sourceSupported =
        sameUrl(round.source, p.evidence_url) || sameUrl(round.source, page.finalUrl) ||
        (isAuthoritativeEvidenceUrl(round.source, org) && pageLinksTo(page.text, round.source));
      checks.push({ name: `round-${index + 1}-source-supported`, pass: sourceSupported, detail: round.source });
      if (!sourceSupported) return fail(checks, 'round source is unrelated to the authoritative evidence page');
    }
  }

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

function isUrlLike(v: unknown): boolean {
  return typeof v === 'string' && /^https?:\/\/\S+$/.test(v);
}

// ---- merge_orgs + anything unrecognized: never auto ----

function neverAuto(detail: string): ValidationResult {
  return {
    pass: false,
    checks: [{ name: 'never-auto-class', pass: false, detail }],
    reason: detail,
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
      return neverAuto('new organizations require owner review');
    case 'new_program':
      return neverAuto('new programs require owner review');
    case 'round_update':
    case 'deadline_change':
      return validateFactUpdate(p);
    case 'status_change':
      return neverAuto('status changes require owner review');
    case 'new_award':
      return validateNewAward();
    case 'profile_note':
      return neverAuto('profile and identity changes require owner review');
    case 'merge_orgs':
      return neverAuto('org merges are never automated');
    default:
      return neverAuto(`unrecognized proposal type "${p.type as string}"`);
  }
}
