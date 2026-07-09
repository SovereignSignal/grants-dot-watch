// Shared auth check for every /api/desk/* route. Not itself a route (Next
// only treats files literally named route.ts as routes).
export const COOKIE_NAME = 'gw_admin';

export function checkAuth(req: Request): { ok: boolean; dev?: boolean } {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return { ok: true, dev: true }; // local dev: gate is open

  const header = req.headers.get('x-admin-token');
  if (header && header === adminToken) return { ok: true };

  const cookieHeader = req.headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== COOKIE_NAME) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    if (value === adminToken) return { ok: true };
  }
  return { ok: false };
}

export function unauthorized() {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
