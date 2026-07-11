import Link from 'next/link';
import type { Query } from './query';
import { hrefWith } from './query';

/** Server-side pager — .coord styled, Prev/Next as Links carrying the page param. */
export function Pager({ base, query, page, pageCount }: { base: string; query: Query; page: number; pageCount: number }) {
  if (pageCount <= 1) return null;
  const prevHref = hrefWith(base, query, { page: page > 2 ? String(page - 1) : undefined });
  const nextHref = hrefWith(base, query, { page: String(page + 1) });
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 border-t border-line py-4">
      {page > 1 ? (
        <Link href={prevHref} className="coord hover:text-dim">
          ← Prev
        </Link>
      ) : (
        <span className="coord opacity-30">← Prev</span>
      )}
      <span className="coord">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={nextHref} className="coord hover:text-dim">
          Next →
        </Link>
      ) : (
        <span className="coord opacity-30">Next →</span>
      )}
    </nav>
  );
}
