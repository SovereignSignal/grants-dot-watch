import { seedFromFiles } from '@/lib/desk-store';
import { checkAuth, unauthorized } from '../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await checkAuth(req);
  if (!auth.ok) return unauthorized();

  const result = await seedFromFiles();
  return Response.json({ ...result, dev: auth.dev === true });
}
