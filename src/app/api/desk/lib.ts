// Shared auth check for every /api/desk/* route. Not itself a route (Next
// only treats files literally named route.ts as routes).
//
// Two independent paths, either is sufficient:
//   (a) machine path — x-admin-token header or gw_admin cookie, checked
//       against ADMIN_TOKEN. Unchanged from the pre-Privy gate, timing-safe,
//       fails closed in production when ADMIN_TOKEN is unset.
//   (b) owner path — a Privy access token (Authorization: Bearer) verified
//       via @privy-io/node, whose verified email (fetched from Privy's own
//       API, never a client-supplied field) is in DESK_OWNERS.
import { timingSafeEqual } from 'node:crypto';
import { PrivyClient } from '@privy-io/node';

export const COOKIE_NAME = 'gw_admin';

/** Constant-time string comparison — token checks must not leak length/prefix timing. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function checkMachineAuth(req: Request, adminToken: string): boolean {
  const header = req.headers.get('x-admin-token');
  if (header && safeEqual(header, adminToken)) return true;

  const cookieHeader = req.headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== COOKIE_NAME) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    if (safeEqual(value, adminToken)) return true;
  }
  return false;
}

// --- Privy owner path ---

let _privy: PrivyClient | null = null;

/** Lazy singleton — avoids constructing the client when Privy env vars are unset. */
function getPrivyClient(): PrivyClient | null {
  if (_privy) return _privy;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) return null;
  _privy = new PrivyClient({ appId, appSecret });
  return _privy;
}

function deskOwners(): string[] {
  return (process.env.DESK_OWNERS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isDeskOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return deskOwners().includes(email.toLowerCase());
}

interface PrivyLinkedAccount {
  type?: unknown;
  address?: unknown;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

/** Extract an email only from Privy's verified email account shape.
 * OAuth and malformed account shapes fail closed. */
function verifiedEmailFromPrivyUser(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const linkedAccounts = (user as { linked_accounts?: unknown }).linked_accounts;
  if (!Array.isArray(linkedAccounts)) return null;

  const accounts = linkedAccounts.filter(
    (account): account is PrivyLinkedAccount => Boolean(account) && typeof account === 'object',
  );
  return accounts
    .filter((account) => account.type === 'email')
    .map((account) => nonEmptyString(account.address))
    .find((address): address is string => Boolean(address)) || null;
}

// Short-TTL cache of DID → verified email, so a burst of admin requests
// doesn't hit Privy's REST API on every call.
const _emailCache = new Map<string, { email: string | null; expires: number }>();
const EMAIL_CACHE_TTL_MS = 60_000;

/** Resolve the *verified* email for a Privy DID from Privy's own API — the
 *  authoritative source for the DESK_OWNERS check. Never trust a client-sent field. */
async function fetchVerifiedEmail(did: string): Promise<string | null> {
  const now = Date.now();
  const cached = _emailCache.get(did);
  if (cached && cached.expires > now) return cached.email;

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) return null;

  let email: string | null = null;
  try {
    const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`,
        'privy-app-id': appId,
      },
    });
    if (res.ok) {
      email = verifiedEmailFromPrivyUser(await res.json());
    }
  } catch {
    email = null;
  }

  _emailCache.set(did, { email, expires: now + EMAIL_CACHE_TTL_MS });
  return email;
}

async function checkPrivyAuth(req: Request): Promise<boolean> {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;
  const token = header.slice(7);

  const privy = getPrivyClient();
  if (!privy) return false;

  try {
    const claims = await privy.utils().auth().verifyAccessToken(token);
    const email = await fetchVerifiedEmail(claims.user_id);
    return isDeskOwnerEmail(email);
  } catch {
    return false;
  }
}

export async function checkAuth(req: Request): Promise<{ ok: boolean; dev?: boolean }> {
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    // No machine token configured: open ONLY outside production (dev
    // convenience). In production the Desk fails closed on the machine path
    // — an unset env var must never publish the gate — but a verified Privy
    // owner can still get in.
    if (process.env.NODE_ENV === 'production') {
      if (await checkPrivyAuth(req)) return { ok: true };
      return { ok: false };
    }
    return { ok: true, dev: true };
  }

  if (checkMachineAuth(req, adminToken)) return { ok: true };
  if (await checkPrivyAuth(req)) return { ok: true };
  return { ok: false };
}

export function unauthorized() {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
