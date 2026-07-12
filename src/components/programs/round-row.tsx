'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The departures row pattern: big serif day-number over small month/year,
 * title + small-caps subtitle, size, mechanism, and a status word next to a
 * wire square. Shared by the Departures board (title=program, subtitle=org)
 * and the program detail page's rounds list (title=round name).
 *
 * `day`/`monthYear` are null for undated rounds — the date cell renders an
 * en dash rather than fabricating one.
 *
 * Client Component: the nested source `<a>` inside the row's own `<Link>`
 * needs onClick/stopPropagation so clicking it doesn't also trigger the
 * outer Link's navigation — an event handler, which only a Client Component
 * can pass to a DOM element.
 */
export function RoundRow({
  href,
  day,
  monthYear,
  closingSoon,
  title,
  subtitle,
  size,
  mechanism,
  statusWord,
  wireColor,
  sourceHref,
}: {
  href?: string;
  day: number | null;
  monthYear: string | null;
  closingSoon: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: ReactNode;
  mechanism?: ReactNode;
  statusWord: string;
  wireColor: string | null;
  sourceHref?: string;
}) {
  const dateTone = closingSoon ? 'text-closing' : 'text-paper';
  const inner = (
    <>
      <div className="flex flex-col">
        <span className={`serif-statement text-[26px] leading-none not-italic tabular-nums ${dateTone}`}>{day ?? '–'}</span>
        {monthYear && <span className={`coord mt-1 whitespace-nowrap ${closingSoon ? 'text-closing' : ''}`}>{monthYear}</span>}
      </div>
      <div className="min-w-0">
        <div className="display truncate text-[15.5px] leading-tight text-paper">{title}</div>
        {subtitle && <div className="coord mt-0.5 truncate">{subtitle}</div>}
      </div>
      <div className="col-span-2 text-[12.5px] leading-snug text-dim tabular-nums sm:col-span-1">{size || '–'}</div>
      <div className="col-span-2 text-[12.5px] capitalize leading-snug text-dim sm:col-span-1">{mechanism || '–'}</div>
      <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:justify-end">
        <span aria-hidden className="size-1.5 shrink-0" style={{ background: wireColor || 'var(--color-faint)' }} />
        <span className={`text-[12px] font-bold ${closingSoon ? 'text-closing' : 'text-paper'}`}>{statusWord}</span>
        {sourceHref && (
          <a
            href={sourceHref}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="coord ml-1 shrink-0 text-faint hover:text-paper"
          >
            source ↗
          </a>
        )}
      </div>
    </>
  );

  const cls =
    'grid grid-cols-[52px_1fr] items-start gap-x-4 gap-y-1.5 border-b border-line py-3 transition-colors sm:grid-cols-[72px_1fr_160px_110px_120px] sm:items-center sm:gap-x-5';

  if (href) {
    return (
      <Link href={href} className={`${cls} hover:bg-raised/40`}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}
