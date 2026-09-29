import { serveUpdates } from '@/lib/wire-updates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return serveUpdates(request);
}
