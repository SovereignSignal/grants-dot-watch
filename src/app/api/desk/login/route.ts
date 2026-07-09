import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const THIRTY_DAYS = 60 * 60 * 24 * 30;

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
    // local dev: no token configured, the gate is already open — set the
    // cookie anyway so the UI has something consistent to send back.
    const res = NextResponse.json({ ok: true, dev: true });
    if (token) res.cookies.set(COOKIE_NAME, token, { httpOnly: true, maxAge: THIRTY_DAYS, sameSite: 'lax', path: '/' });
    return res;
  }

  if (!token || token !== adminToken) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, adminToken, { httpOnly: true, maxAge: THIRTY_DAYS, sameSite: 'lax', path: '/' });
  return res;
}
