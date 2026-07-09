// The relational galaxy graph — funder orgs + system hubs, co-funding as the
// edges (docs/galaxy-3d-direction.md). Rebuilt from loadRegistry() on every
// request; loadRegistry() itself is cheaply cached (mtime-checked).
import { NextResponse } from 'next/server';
import { buildGalaxyGraph } from '@/lib/galaxy-graph';

export async function GET() {
  const graph = buildGalaxyGraph();

  return NextResponse.json(graph, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
