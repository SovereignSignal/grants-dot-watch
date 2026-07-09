// Compact search index over the whole register — powers the header search
// (src/components/search.tsx). Rebuilt from loadRegistry() on every request;
// loadRegistry() itself is cheaply cached (mtime-checked), so this stays fast.
import { NextResponse } from 'next/server';
import { loadRegistry } from '@/lib/registry';

export interface SearchIndexItem {
  t: 'system' | 'org' | 'program' | 'grantee';
  id: string;
  n: string;
  a?: string[];
}

export async function GET() {
  const { systems, orgs, programs, grantees } = loadRegistry();

  const items: SearchIndexItem[] = [
    ...systems.map((s): SearchIndexItem => ({ t: 'system', id: s.id, n: s.name })),
    ...orgs.map((o): SearchIndexItem => {
      const item: SearchIndexItem = { t: 'org', id: o.id, n: o.name };
      if (o.aka && o.aka.length > 0) item.a = o.aka;
      return item;
    }),
    ...programs.map((p): SearchIndexItem => ({ t: 'program', id: p.id, n: p.name })),
    // grantees only surface once >=2 funders have touched them — keeps the
    // payload sane and matches the site's own bar for a "notable" grantee.
    ...grantees
      .filter((g) => g.funders.length >= 2)
      .map((g): SearchIndexItem => ({ t: 'grantee', id: g.slug, n: g.name })),
  ];

  return NextResponse.json(items, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
