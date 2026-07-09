// The instrument panel: registry counts, load state, awards-by-year, and
// (once wired) the curation desk queue depth. Server component — reads
// loadRegistry() directly and, optionally, the desk store.
import { loadRegistry } from '@/lib/registry';
import { Card, Coord, Empty, PageHeader, Stat } from '@/components/ui';

export const metadata = { title: 'Health' };

interface DeskSummary {
  pending: number;
  decided: number;
}

/**
 * desk-store.ts is owned by a different agent and may not exist yet, so the
 * specifier is kept out of a string literal — that stops TypeScript from
 * statically resolving (and failing on) a module that hasn't landed. Once it
 * exists we try a few plausible export shapes and degrade quietly if none
 * match rather than take the health page down.
 */
async function loadDeskSummary(): Promise<DeskSummary | null> {
  try {
    const specifier = ['@/lib', 'desk-store'].join('/');
    const mod: Record<string, unknown> = await import(specifier);

    for (const name of ['getDeskSummary', 'deskSummary', 'getDeskCounts']) {
      const fn = mod[name];
      if (typeof fn === 'function') {
        const v = (await fn()) as Partial<DeskSummary> | undefined;
        if (v && typeof v.pending === 'number' && typeof v.decided === 'number') {
          return { pending: v.pending, decided: v.decided };
        }
      }
    }

    for (const name of ['getProposals', 'listProposals', 'loadProposals', 'getAllProposals']) {
      const fn = mod[name];
      if (typeof fn === 'function') {
        const proposals = (await fn()) as Array<{ state?: string }> | undefined;
        if (Array.isArray(proposals)) {
          const pending = proposals.filter((p) => p.state === 'pending').length;
          const decided = proposals.filter((p) => p.state && p.state !== 'pending').length;
          return { pending, decided };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
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
      <PageHeader eyebrow="INSTRUMENT" title="Health" sub="Registry counts, load state, and the curation desk — at a glance." />
      <div className="mx-auto max-w-6xl px-4 pb-16 space-y-6">
        <Card>
          <Coord>Registry counts</Coord>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
            <Stat label="Systems" value={counts.systems} />
            <Stat label="Orgs" value={counts.orgs} />
            <Stat label="Funders" value={counts.funders} />
            <Stat label="Programs" value={counts.programs} />
            <Stat label="Awards" value={counts.awards} />
            <Stat label="Grantees" value={counts.grantees} />
          </div>
          <div className="starline mt-4 pt-3 coord">loaded {formatLoadedAt(loadedAt)}</div>
        </Card>

        <Card>
          <Coord>Awards by year</Coord>
          {years.length === 0 ? (
            <div className="mt-3">
              <Empty>No awards on file.</Empty>
            </div>
          ) : (
            <div className="mt-3 space-y-1.5 overflow-x-auto">
              {years.map(([year, n]) => {
                const barLen = Math.max(1, Math.round((n / maxYearCount) * 30));
                return (
                  <div key={year} className="flex items-center gap-3 font-mono text-xs">
                    <span className="coord w-16 shrink-0">{year}</span>
                    <span className="text-signal shrink-0" aria-hidden>
                      {'▪'.repeat(barLen)}
                    </span>
                    <span className="text-dim">{n}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <Coord>The Desk</Coord>
          {desk ? (
            <div className="mt-3 grid grid-cols-2 gap-4 max-w-xs">
              <Stat label="Pending" value={desk.pending} />
              <Stat label="Decided" value={desk.decided} />
            </div>
          ) : (
            <p className="mt-3 text-sm text-dim">desk: not wired yet</p>
          )}
        </Card>
      </div>
    </div>
  );
}
