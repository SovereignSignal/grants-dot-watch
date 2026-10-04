import { serveFundingV2 } from '@/lib/public-api-v2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path?: string[] }> };

export async function GET(request: Request, context: Context) {
  return serveFundingV2(request, (await context.params).path || []);
}

export const HEAD = GET;

export function OPTIONS(request: Request) {
  return serveFundingV2(request, []);
}
