// Curator API keys. Separate from ADMIN_TOKEN, DESK_OWNERS, and
// GRANTS_WATCH_READER_KEYS. The env var holds SHA-256 hashes only.
import { createHash, timingSafeEqual } from 'node:crypto';

export const CURATOR_SCOPES = ['read_queue', 'decide', 'propose', 'apply_low_risk'] as const;
export type CuratorScope = (typeof CURATOR_SCOPES)[number];

export interface CuratorIdentity {
  id: string;
  name: string;
  scopes: CuratorScope[];
}

interface CuratorKey {
  id: string;
  name: string;
  sha256: string;
  scopes: CuratorScope[];
  expires_at: string;
  revoked: boolean;
  revoked_at: string | null;
}

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const SCOPE_SET = new Set<string>(CURATOR_SCOPES);
const EXPIRY = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const WRITE_LIMIT = 30;
const WINDOW_MS = 60_000;

export function curatorJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...headers, ...extra } });
}

function validName(name: string): boolean {
  return name.length >= 1 && name.length <= 80 && name.trim() === name && !/[\u0000-\u001f\u007f]/.test(name);
}

function validInstant(value: string): boolean {
  return EXPIRY.test(value) && Number.isFinite(Date.parse(value));
}

function keys(value: string | undefined): CuratorKey[] {
  const parsed: unknown = JSON.parse(value || '[]');
  if (!Array.isArray(parsed) || parsed.length > 100) throw new Error('Invalid curator keys');
  for (const key of parsed) {
    if (!key || typeof key !== 'object') throw new Error('Invalid curator key');
    const record = key as Record<string, unknown>;
    if (typeof record.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(record.id)) throw new Error('Invalid curator key');
    if (!validName(typeof record.name === 'string' ? record.name : '')) throw new Error('Invalid curator key');
    if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('Invalid curator key');
    if (!Array.isArray(record.scopes) || record.scopes.length < 1 || record.scopes.length > CURATOR_SCOPES.length) {
      throw new Error('Invalid curator key');
    }
    if (record.scopes.some((scope) => typeof scope !== 'string' || !SCOPE_SET.has(scope))) throw new Error('Invalid curator key');
    if (new Set(record.scopes).size !== record.scopes.length) throw new Error('Invalid curator key');
    if (typeof record.expires_at !== 'string' || !validInstant(record.expires_at)) throw new Error('Invalid curator key');
    if (record.revoked !== undefined && typeof record.revoked !== 'boolean') throw new Error('Invalid curator key');
    if (record.revoked_at !== undefined && record.revoked_at !== null) {
      if (typeof record.revoked_at !== 'string' || !validInstant(record.revoked_at)) throw new Error('Invalid curator key');
    }
  }
  const typed = parsed as Record<string, unknown>[];
  if (new Set(typed.map((key) => key.id)).size !== typed.length) throw new Error('Duplicate curator key');
  if (new Set(typed.map((key) => key.sha256)).size !== typed.length) throw new Error('Duplicate curator key');
  return typed.map((key) => ({
    id: key.id as string,
    name: key.name as string,
    sha256: key.sha256 as string,
    scopes: key.scopes as CuratorScope[],
    expires_at: key.expires_at as string,
    revoked: key.revoked === true,
    revoked_at: typeof key.revoked_at === 'string' ? key.revoked_at : null,
  }));
}

function digestEqual(digest: Buffer, hex: string): boolean {
  const other = Buffer.from(hex, 'hex');
  if (other.length !== digest.length) return false;
  return timingSafeEqual(digest, other);
}

function revoked(key: CuratorKey, now: number): boolean {
  if (key.revoked) return true;
  return key.revoked_at !== null && Date.parse(key.revoked_at) <= now;
}

export type CuratorKeyStanding =
  | { status: 'active'; identity: CuratorIdentity }
  | { status: 'unknown' | 'inactive' | 'unavailable' };

/** A key's current standing by id, read from the same configuration and with
 *  the same expiry and revocation rules as `authorize`, for work that acts on
 *  a curator's behalf without a request (the daily Desk upkeep). */
export function curatorKeyStanding(
  id: string,
  config = () => process.env.GRANTS_WATCH_CURATOR_KEYS,
  now = Date.now
): CuratorKeyStanding {
  let configured: CuratorKey[];
  try {
    configured = keys(config());
  } catch {
    return { status: 'unavailable' };
  }
  const key = configured.find((item) => item.id === id);
  if (!key) return { status: 'unknown' };
  const timestamp = now();
  if (Date.parse(key.expires_at) <= timestamp || revoked(key, timestamp)) return { status: 'inactive' };
  return { status: 'active', identity: { id: key.id, name: key.name, scopes: [...key.scopes] } };
}

export interface CuratorGate {
  authorize(request: Request, scope: CuratorScope | readonly CuratorScope[]): { identity: CuratorIdentity } | { response: Response };
  consumeWrite(id: string): { ok: true } | { response: Response };
}

export function createCuratorGate(config = () => process.env.GRANTS_WATCH_CURATOR_KEYS, now = Date.now): CuratorGate {
  const windows = new Map<string, { start: number; requests: number }>();
  return {
    authorize(request, scope) {
      let configured: CuratorKey[];
      try {
        configured = keys(config());
      } catch {
        return { response: curatorJson({ error: 'curator_unavailable' }, 503) };
      }
      if (!configured.length) return { response: curatorJson({ error: 'curator_unavailable' }, 503) };

      const token = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('authorization') || '')?.[1];
      const digest = createHash('sha256').update(token || '').digest();
      const timestamp = now();
      let matched: CuratorKey | null = null;
      for (const key of configured) {
        if (digestEqual(digest, key.sha256)) matched = key;
      }
      if (!token || !matched || Date.parse(matched.expires_at) <= timestamp || revoked(matched, timestamp)) {
        return { response: curatorJson({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' }) };
      }
      const required = Array.isArray(scope) ? scope : [scope];
      if (!required.length || !required.some((item) => matched.scopes.includes(item))) {
        return { response: curatorJson({ error: 'forbidden' }, 403) };
      }
      return { identity: { id: matched.id, name: matched.name, scopes: [...matched.scopes] } };
    },
    consumeWrite(id) {
      const timestamp = now();
      for (const [key, window] of windows) if (timestamp - window.start >= WINDOW_MS) windows.delete(key);
      const window = windows.get(id) || { start: timestamp, requests: 0 };
      windows.set(id, window);
      if (window.requests >= WRITE_LIMIT) {
        return {
          response: curatorJson({ error: 'rate_limited' }, 429, {
            'Retry-After': String(Math.max(1, Math.ceil((WINDOW_MS - timestamp + window.start) / 1000))),
          }),
        };
      }
      window.requests += 1;
      return { ok: true };
    },
  };
}

export const curatorGate = createCuratorGate();
