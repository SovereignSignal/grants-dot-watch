import Link from 'next/link';
import { hrefWith, type Query } from '@/components/ledger/query';
import { tabClass } from '@/components/ui-filters';

export type ProgramsView = 'departures' | 'cadence';

const TABS: { view: ProgramsView; label: string }[] = [
  { view: 'departures', label: 'Departures' },
  { view: 'cadence', label: 'Cadence' },
];

/** Two small-caps tab links with an active underline. Shareable — the active
 *  tab lives in ?view=, carried through hrefWith alongside whatever filters
 *  are already on the URL. */
export function ProgramsTabs({ active, query }: { active: ProgramsView; query: Query }) {
  return (
    <nav aria-label="Programs view" className="flex items-center gap-6 border-b border-line">
      {TABS.map((t) => {
        const isActive = t.view === active;
        const href = hrefWith('/programs', query, { view: t.view === 'departures' ? undefined : t.view });
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
