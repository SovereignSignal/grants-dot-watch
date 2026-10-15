import { revertAutoApply } from '@/lib/desk-revert';
import { checkAuth, unauthorized } from '../../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await checkAuth(req);
  if (!auth.ok) return unauthorized();
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }
  if (!body.id || typeof body.id !== 'string') return Response.json({ error: 'id is required' }, { status: 400 });
  const result = await revertAutoApply(body.id);
  return Response.json(result.body, { status: result.status });
}
