// Low-risk curator auto-apply. An X handle is approved only when the quote and
// a page the server fetched both name that exact handle, on the organization's
// own site. Clears are a separate field edit and are not approved here.
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { CuratorAutoApply } from './types';

export const FETCH_TIMEOUT_MS = 8_000;
export const FETCH_MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

const HANDLE_URL = /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/?$/i;
const SHARED_SITE = new Set(['x.com', 'twitter.com']);

export interface XHandleEdit {
  orgId: string;
  clear: boolean;
  handle: string | null;
  url: string | null;
}

export type PageFetch =
  | { ok: true; body: string; hash: string; url: string }
  | { ok: false; reason: 'fetch_failed' };

export type PageLookup = (hostname: string) => Promise<Array<{ address: string }>>;

export function curatorAutoApplyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CURATOR_AUTO_APPLY !== '0';
}

/** Comma-separated fact names. Unset means `x_handle` only. An empty value allows nothing. */
export function curatorAutoApplyTypes(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.CURATOR_AUTO_APPLY_TYPES === undefined ? 'x_handle' : env.CURATOR_AUTO_APPLY_TYPES;
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export function autoApplyNote(reason: string): string {
  const trimmed = reason.trim();
  return trimmed.startsWith('auto:') ? trimmed : `auto: ${trimmed}`;
}

/** A profile note that only sets or clears `socials.x` on one org file. */
export function readXHandleEdit(change: unknown): XHandleEdit | null {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return null;
  const entries = Object.entries(change as Record<string, unknown>).filter(([key]) => key !== '_expected_content_hashes');
  if (entries.length !== 1) return null;
  const [path, value] = entries[0];
  const orgId = /^orgs\/([a-z0-9][a-z0-9-]*)\.yaml$/.exec(path)?.[1];
  if (!orgId || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const map = value as Record<string, unknown>;
  if (Object.keys(map).some((field) => field !== 'socials' && field !== 'sources')) return null;
  if (!map.socials || typeof map.socials !== 'object' || Array.isArray(map.socials)) return null;
  const socials = map.socials as Record<string, unknown>;
  if (Object.keys(socials).some((key) => key !== 'x') || !('x' in socials)) return null;
  if (socials.x === null) return { orgId, clear: true, handle: null, url: null };
  if (typeof socials.x !== 'string') return null;
  const handle = HANDLE_URL.exec(socials.x)?.[1];
  if (!handle) return null;
  return { orgId, clear: false, handle, url: `https://x.com/${handle}` };
}

/** The org website host, without a leading www. Shared platforms are not an org site. */
export function registeredDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  let host: string;
  try {
    host = new URL(website).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return null;
  }
  if (!host || SHARED_SITE.has(host) || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')) return null;
  return host;
}

export function hostMatchesRegisteredDomain(url: string, domain: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    host = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return false;
  }
  return host === domain || host.endsWith(`.${domain}`);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*47;/g, '/')
    .replace(/&#x0*2f;/gi, '/');
}

/** True when the text contains x.com/<handle> or twitter.com/<handle> and not a longer handle or a status path. */
export function textHasExactHandleLink(text: string, handle: string): boolean {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:https?:\\/\\/)?(?:www\\.)?(?:x\\.com|twitter\\.com)\\/${escaped}(?=$|[?#]|[\\s"'<>.,;:)\\]]|\\/(?=$|[?#\\s"'<>.,;:)\\]]))`,
    'i'
  );
  return pattern.test(decodeHtml(text));
}

export function isPrivateAddress(address: string): boolean {
  const mapped = address.toLowerCase();
  if (mapped === '::1' || mapped === '::' || mapped === '0:0:0:0:0:0:0:1') return true;
  if (mapped.startsWith('fe80:') || mapped.startsWith('fc') || mapped.startsWith('fd')) return true;
  const v4 = mapped.startsWith('::ffff:') ? mapped.slice('::ffff:'.length) : mapped;
  const parts = v4.split('.');
  if (parts.length !== 4) return mapped.includes(':') ? false : true;
  const nums = parts.map((part) => Number(part));
  if (nums.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = nums;
  if (a === 0 || a === 10 || a === 127 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.includes(':')) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return isPrivateAddress(host);
  return false;
}

async function defaultLookup(hostname: string): Promise<Array<{ address: string }>> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((item) => ({ address: item.address }));
}

function allowedContentType(header: string | null): boolean {
  if (!header) return true;
  const type = header.split(';')[0].trim().toLowerCase();
  return (
    type.startsWith('text/') ||
    type === 'application/xhtml+xml' ||
    type === 'application/xml' ||
    type === 'application/json'
  );
}

async function readCapped(response: Response): Promise<{ bytes: Uint8Array; body: string } | null> {
  const declared = Number(response.headers.get('content-length') || '');
  if (Number.isFinite(declared) && declared > FETCH_MAX_BYTES) return null;
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > FETCH_MAX_BYTES) return null;
    const bytes = Buffer.from(text);
    return { bytes, body: text };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > FETCH_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, body: new TextDecoder('utf-8', { fatal: false }).decode(bytes) };
}

async function hostIsPublic(hostname: string, resolve: PageLookup): Promise<boolean> {
  if (blockedHostname(hostname)) return false;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await resolve(hostname);
  } catch {
    return false;
  }
  if (!addresses.length) return false;
  return addresses.every((item) => item.address && !isPrivateAddress(item.address));
}

function parseHttps(value: string, base?: string): URL | null {
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;
  return url;
}

/** Fetch one https page on `allowedDomain`, refusing private addresses, off-domain redirects, and oversized bodies. */
export async function fetchEvidencePage(
  target: string,
  allowedDomain: string,
  deps: { fetchImpl?: typeof fetch; lookupImpl?: PageLookup } = {}
): Promise<PageFetch> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolve = deps.lookupImpl ?? defaultLookup;
  let current = parseHttps(target);
  if (!current || !hostMatchesRegisteredDomain(current.href, allowedDomain)) return { ok: false, reason: 'fetch_failed' };
  const seen = new Set<string>();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (seen.has(current.href)) return { ok: false, reason: 'fetch_failed' };
    seen.add(current.href);
    if (!(await hostIsPublic(current.hostname, resolve))) return { ok: false, reason: 'fetch_failed' };
    let response: Response;
    try {
      response = await fetchImpl(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'text/html, text/plain;q=0.9', 'user-agent': 'grants.watch curator' },
      });
    } catch {
      return { ok: false, reason: 'fetch_failed' };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { ok: false, reason: 'fetch_failed' };
      const next = parseHttps(location, current.href);
      if (!next || !hostMatchesRegisteredDomain(next.href, allowedDomain)) return { ok: false, reason: 'fetch_failed' };
      current = next;
      continue;
    }
    if (response.status !== 200 || !allowedContentType(response.headers.get('content-type'))) {
      return { ok: false, reason: 'fetch_failed' };
    }
    const read = await readCapped(response);
    if (!read) return { ok: false, reason: 'fetch_failed' };
    return {
      ok: true,
      body: read.body,
      hash: createHash('sha256').update(read.bytes).digest('hex'),
      url: current.href,
    };
  }
  return { ok: false, reason: 'fetch_failed' };
}

export async function assessXHandleApply(input: {
  edit: XHandleEdit;
  website: string | null | undefined;
  oldValue: string | null;
  quotes: { url: string; quote: string }[];
  fetchPage: (url: string, allowedDomain: string) => Promise<PageFetch>;
  keyId: string;
}): Promise<{ ok: true; audit: CuratorAutoApply } | { ok: false; reason: string }> {
  if (input.edit.clear || !input.edit.handle || !input.edit.url) return { ok: false, reason: 'clear_not_auto' };
  const domain = registeredDomain(input.website);
  if (!domain) return { ok: false, reason: 'no_website' };
  const onDomain = input.quotes.filter((quote) => hostMatchesRegisteredDomain(quote.url, domain));
  if (!onDomain.length) return { ok: false, reason: 'domain_mismatch' };
  const matched = onDomain.filter((quote) => textHasExactHandleLink(quote.quote, input.edit.handle as string));
  if (!matched.length) return { ok: false, reason: 'quote_mismatch' };
  let sawPage = false;
  for (const quote of matched) {
    let page: PageFetch;
    try {
      page = await input.fetchPage(quote.url, domain);
    } catch {
      page = { ok: false, reason: 'fetch_failed' };
    }
    if (!page.ok) continue;
    sawPage = true;
    if (!textHasExactHandleLink(page.body, input.edit.handle)) continue;
    return {
      ok: true,
      audit: {
        key_id: input.keyId,
        fetched_url: page.url,
        page_hash: page.hash,
        old_value: input.oldValue,
        new_value: input.edit.url,
      },
    };
  }
  return { ok: false, reason: sawPage ? 'page_missing_link' : 'fetch_failed' };
}
