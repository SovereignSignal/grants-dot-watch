// The instrument panel: registry counts, load state, awards-by-year, and
// the curation desk queue depth. Server component — reads loadRegistry()
// directly and the desk store.
import { loadRegistry } from '@/lib/registry';
import { listProposals } from '@/lib/desk-store';
import { Card, Coord, Empty, PageHeader, Stat } from '@/components/ui';

export const metadata = { title: 'Health' };

// Reads the desk store (Postgres in prod) — must never prerender at build time,
// where the DB's private network is unreachable.
export const dynamic = 'force-dynamic';

interface DeskSummary {
  pending: number;
  decided: number;
}

/** Desk operational state (see desk-store.ts) — a missing/corrupt local store
 *  or an empty Postgres queue reads as empty, never throws, so this can't
 *  take the health page down. */
async function loadDeskSummary(): Promise<DeskSummary> {
  const proposals = await listProposals();
  const pending = proposals.filter((p) => p.state === 'pending').length;
  const decided = proposals.length - pending;
  return { pending, decided };
}

function formatLoadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export default async function HealthPage() {
  const { counts, awards, loadedAt } = loadRegistry();
  const desk = await loadDeskSummary();

  const byYear = new Map<string, number>();
  for (const a of awards) {
    const year = a.date ? a.date.slice(0, 4) : 'Undated';
    byYear.set(year, (byYear.get(year) || 0) + 1);
  }
  const years = [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const maxYearCount = Math.max(1, ...years.map(([, n]) => n));

  return (
    <div>
      <PageHeader
        eyebrow="THE INSTRUMENT PANEL"
        title="Health"
        sub="Registry counts, load state, and the curation desk — ledgered, not dashboarded."
      />
      <div className="mx-auto max-w-6xl px-4 pb-16 space-y-8">
        <Card>
          <Coord>Registry counts</Coord>
          <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-3 md:grid-cols-6">
            {[
              { label: 'Systems', value: counts.systems },
              { label: 'Orgs', value: counts.orgs },
              { label: 'Funders', value: counts.funders },
              { label: 'Programs', value: counts.programs },
              { label: 'Awards', value: counts.awards },
              { label: 'Grantees', value: counts.grantees },
            ].map((s) => (
              <div key={s.label} className="px-4 py-3.5 first:pl-0">
                <Stat label={s.label} value={s.value} />
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3 coord">Registry loaded {formatLoadedAt(loadedAt)}</div>
        </Card>

        <Card>
          <Coord>Awards by year</Coord>
          {years.length === 0 ? (
            <div className="mt-3">
              <Empty>No awards on file.</Empty>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-line border-t border-line overflow-x-auto">
              {years.map(([year, n]) => {
                const barLen = Math.max(1, Math.round((n / maxYearCount) * 30));
                return (
                  <div key={year} className="flex items-center gap-4 py-2 text-xs">
                    <span className="w-16 shrink-0 font-mono text-[11px] font-semibold tracking-[.08em] text-faint">{year}</span>
                    <span className="shrink-0 font-mono text-signal" aria-hidden>
                      {'▪'.repeat(barLen)}
                    </span>
                    <span className="ml-auto font-mono tabular-nums text-dim">{n.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <Coord>The Desk</Coord>
          <div className="mt-4 grid max-w-xs grid-cols-2 divide-x divide-line border-t border-line">
            <div className="py-3.5 pr-4">
              <Stat label="Pending" value={desk.pending} />
            </div>
            <div className="py-3.5 pl-4">
              <Stat label="Decided" value={desk.decided} />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
