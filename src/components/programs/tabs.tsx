import Link from 'next/link';
import { hrefWith, type Query } from '@/components/ledger/query';
import { tabClass } from '@/components/ui-filters';

export type ProgramsView = 'all' | 'departures' | 'cadence';

const TABS: { view: ProgramsView; label: string }[] = [
  { view: 'all', label: 'All programs' },
  { view: 'departures', label: 'Current calls' },
  { view: 'cadence', label: 'Calendar' },
];

/** View links share one directory and its filters. Shareable — the active
 *  tab lives in ?view=, carried through hrefWith alongside whatever filters
 *  are already on the URL. */
export function ProgramsTabs({ active, query }: { active: ProgramsView; query: Query }) {
  return (
    <nav aria-label="Programs view" className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line">
      {TABS.map((t) => {
        const isActive = t.view === active;
        const href = hrefWith('/programs', query, { view: t.view === 'all' ? undefined : t.view });
        return (
          <Link
            key={t.view}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={tabClass(isActive)}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
