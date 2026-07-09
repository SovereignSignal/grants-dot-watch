// Shared auth check for every /api/desk/* route. Not itself a route (Next
// only treats files literally named route.ts as routes).
import { timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'gw_admin';

/** Constant-time string comparison — token checks must not leak length/prefix timing. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function checkAuth(req: Request): { ok: boolean; dev?: boolean } {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    // No token configured: open ONLY outside production. In production the
    // Desk fails closed — an unset env var must never publish the gate.
    if (process.env.NODE_ENV === 'production') return { ok: false };
    return { ok: true, dev: true };
  }

  const header = req.headers.get('x-admin-token');
  if (header && safeEqual(header, adminToken)) return { ok: true };

  const cookieHeader = req.headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== COOKIE_NAME) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    if (safeEqual(value, adminToken)) return { ok: true };
  }
  return { ok: false };
}

export function unauthorized() {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
