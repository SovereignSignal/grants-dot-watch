import { NextResponse } from 'next/server';
import { COOKIE_NAME, safeEqual } from '../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const COOKIE_OPTS = {
  httpOnly: true,
  maxAge: THIRTY_DAYS,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const adminToken = process.env.ADMIN_TOKEN;
  const token = (body.token || '').trim();

  if (!adminToken) {
    // No token configured: dev convenience only. In production the Desk
    // fails closed — same rule as checkAuth.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'desk not configured' }, { status: 503 });
    }
    return NextResponse.json({ ok: true, dev: true });
  }

  if (!token || !safeEqual(token, adminToken)) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, adminToken, COOKIE_OPTS);
  return res;
}
