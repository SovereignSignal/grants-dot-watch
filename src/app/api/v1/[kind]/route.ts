import { apiError, apiJson, isCollectionKind, queryCollection } from '@/lib/public-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return apiJson(null);
}

export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  if (!isCollectionKind(kind)) {
    return apiError(404, 'not_found', `No collection named ${kind}. See GET /api/v1.`);
  }
  return apiJson(queryCollection(kind, new URL(req.url).searchParams));
}
