// Compact search index over the whole register — powers the header search
// (src/components/search.tsx). Rebuilt from loadRegistry() on every request;
// loadRegistry() itself is cheaply cached (mtime-checked), so this stays fast.
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
