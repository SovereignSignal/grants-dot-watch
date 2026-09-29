import { createHash, timingSafeEqual } from 'node:crypto';

interface ReaderKey { id: string; sha256: string; expires_at: string }
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

export function readerJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...headers, ...extra } });
}

// Configuration contains hashes only. Re-read it so expiry/revocation cannot
// remain authorized through an in-process credential cache.
function keys(value: string | undefined): ReaderKey[] {
  const parsed: unknown = JSON.parse(value || '[]');
  if (!Array.isArray(parsed) || parsed.length > 100) throw new Error('Invalid reader keys');
  for (const key of parsed) {
    if (!key || typeof key !== 'object' || typeof key.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(key.id)
      || typeof key.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(key.sha256) || typeof key.expires_at !== 'string'
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(key.expires_at)
      || !Number.isFinite(Date.parse(key.expires_at))) throw new Error('Invalid reader key');
  }
  if (new Set(parsed.map(k => k.id)).size !== parsed.length
    || new Set(parsed.map(k => k.sha256)).size !== parsed.length) throw new Error('Duplicate reader key');
  return parsed;
}

export function createReaderGate(config = () => process.env.GRANTS_WATCH_READER_KEYS, now = Date.now) {
  const windows = new Map<string, { start: number; requests: number }>();
  return (request: Request): { client: string } | { response: Response } => {
    let configured: ReaderKey[];
    try { configured = keys(config()); }
    catch { return { response: readerJson({ error: 'reader_unavailable' }, 503) }; }
    if (!configured.length) return { response: readerJson({ error: 'reader_unavailable' }, 503) };
    const token = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('authorization') || '')?.[1];
    const digest = createHash('sha256').update(token || '').digest();
    const timestamp = now();
    const matched = configured.find(k => timingSafeEqual(digest, Buffer.from(k.sha256, 'hex')));
    if (!token || !matched || Date.parse(matched.expires_at) <= timestamp) {
      return { response: readerJson({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' }) };
    }
    for (const [id, window] of windows) if (timestamp - window.start >= 60_000) windows.delete(id);
    const window = windows.get(matched.id) || { start: timestamp, requests: 0 };
    windows.set(matched.id, window);
    if (window.requests >= 60) return { response: readerJson({ error: 'rate_limited' }, 429,
      { 'Retry-After': String(Math.max(1, Math.ceil((60_000 - timestamp + window.start) / 1000))) }) };
    window.requests++;
    return { client: matched.id };
  };
}

export const authorizeReader = createReaderGate();
