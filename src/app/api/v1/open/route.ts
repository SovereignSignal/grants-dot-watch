import { apiJson, queryOpen } from '@/lib/public-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return apiJson(null);
}

export function GET(req: Request) {
  return apiJson(queryOpen(new URL(req.url).searchParams));
}
