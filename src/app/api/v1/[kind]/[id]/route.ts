import { apiError, apiJson, getRecord, isCollectionKind } from '@/lib/public-api';
import { productDateISO } from '@/lib/round-state';
import { loadRegistry } from '@/lib/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return apiJson(null);
}

export async function GET(_req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await ctx.params;
  if (!isCollectionKind(kind)) {
    return apiError(404, 'not_found', `No collection named ${kind}. See GET /api/v1.`);
  }
  const record = getRecord(kind, id);
  if (!record) {
    return apiError(404, 'not_found', `No ${kind.replace(/s$/, '')} with id ${id}.`);
  }
  const registry = loadRegistry();
  return apiJson({
    data: record,
    meta: { as_of: productDateISO(), updated_at: registry.updatedAt },
  });
}
