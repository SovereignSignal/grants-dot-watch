import { permanentRedirect } from 'next/navigation';
import type { SearchParams } from '@/components/ledger/query';

/** Preserve bookmarked directory filters while consolidating public discovery. */
export default async function Opportunities({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  permanentRedirect(`/programs${query.size ? `?${query}` : ''}`);
}
