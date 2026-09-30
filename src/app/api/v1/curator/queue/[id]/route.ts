import { forbidCurator, getCuratorItem } from '@/lib/curator-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return getCuratorItem(req, id);
}

export function DELETE(req: Request) {
  return forbidCurator(req);
}
