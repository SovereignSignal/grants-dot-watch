import { listCuratorQueue } from '@/lib/curator-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return listCuratorQueue(req);
}
