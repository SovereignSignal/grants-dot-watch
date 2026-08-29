import { apiIndex, apiJson } from '@/lib/public-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return apiJson(null);
}

export function GET() {
  return apiJson(apiIndex());
}
