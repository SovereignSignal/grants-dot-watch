// Compact search index over the whole register — powers the header search
// (src/components/search.tsx). Rebuilt from loadRegistry() on every request.
// loadRegistry() serves a warm in-memory index (18us) and re-walks registry file
// mtimes at most once per cache window, so this stays fast. The response below
// also sets Cache-Control: max-age=300, so end-to-end freshness for the header
// search is that 5 minutes ON TOP OF the registry cache bound, not the bound
// alone — that is the number to reach for when this looks stale.
import { NextResponse } from 'next/server';
import { loadRegistry } from '@/lib/registry';

export interface SearchIndexItem {
  t: 'system' | 'org' | 'program';
  id: string;
  n: string;
  a?: string[];
}

export async function GET() {
  const { systems, orgs, programs } = loadRegistry();

  const items: SearchIndexItem[] = [
    ...systems.map((s): SearchIndexItem => ({ t: 'system', id: s.id, n: s.name })),
    ...orgs.map((o): SearchIndexItem => {
      const item: SearchIndexItem = { t: 'org', id: o.id, n: o.name };
      if (o.aka && o.aka.length > 0) item.a = o.aka;
      return item;
    }),
    ...programs.map((p): SearchIndexItem => ({ t: 'program', id: p.id, n: p.name })),
  ];

  return NextResponse.json(items, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
