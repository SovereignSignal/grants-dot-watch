// The instrument panel: registry counts, load state, awards-by-year, and
// the curation desk queue depth. Server component — reads loadRegistry()
// directly and the desk store.
import { loadRegistry } from '@/lib/registry';
import { getIngestState, listProposals } from '@/lib/desk-store';
import { Card, Coord, Empty, PageHeader, Stat } from '@/components/ui';

export const metadata = { title: 'Health' };

// Reads the desk store (Postgres in prod) — must never prerender at build time,
// where the DB's private network is unreachable.
export const dynamic = 'force-dynamic';

interface DeskSummary {
  pending: number;
  decided: number;
}

/** Shape written by src/lib/ingest.ts's runIngest() / the daily timer —
 *  read loosely (everything optional) since ingest_state is a jsonb blob,
 *  not a typed table; a malformed or half-written record should degrade to
 *  "no data" fields, never crash the page. */
interface LastIngestRun {
  at?: string;
  skipped_lock?: boolean;
  error?: string;
  source_counts?: {
    wire?: { fetched?: number; error?: string | null };
    discuss?: { fetched?: number; error?: string | null };
  };
  proposals_created?: number;
  dropped?: number;
  validation?: { passed?: number; failed?: number };
  errors?: string[];
}

/** ingest_state's 'last_run' row (Postgres in prod, .data/ingest-state.json
 *  locally) — absent until the timer or a manual POST /api/ingest/run has
 *  fired at least once. Never throws: a missing/corrupt row reads as null. */
async function loadLastIngestRun(): Promise<LastIngestRun | null> {
  try {
    const v = await getIngestState('last_run');
    return v && typeof v === 'object' ? (v as LastIngestRun) : null;
  } catch {
    return null;
  }
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
  const [desk, ingest] = await Promise.all([loadDeskSummary(), loadLastIngestRun()]);

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

        <Card>
          <Coord>Ingest</Coord>
          {!ingest ? (
            <div className="mt-3">
              <Empty>No ingest run yet — the daily timer is off (INGEST_ENABLED unset) or hasn&apos;t fired.</Empty>
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-4">
                <div className="px-4 py-3.5 pl-0">
                  <Stat label="Proposals created" value={ingest.proposals_created ?? '—'} />
                </div>
                <div className="px-4 py-3.5">
                  <Stat label="Dropped" value={ingest.dropped ?? '—'} />
                </div>
                <div className="px-4 py-3.5">
                  <Stat label="Machine-passed" value={ingest.validation?.passed ?? '—'} />
                </div>
                <div className="px-4 py-3.5">
                  <Stat label="Machine-failed" value={ingest.validation?.failed ?? '—'} />
                </div>
              </div>
              <div className="mt-4 border-t border-line pt-3 coord">
                Last run {ingest.at ? formatLoadedAt(ingest.at) : 'unknown time'}
                {ingest.skipped_lock ? ' — skipped (another instance held the lock)' : ''}
              </div>
              {ingest.source_counts && (
                <div className="mt-1.5 coord text-faint">
                  Wire: {ingest.source_counts.wire?.fetched ?? 0} fetched
                  {ingest.source_counts.wire?.error ? ` (error: ${ingest.source_counts.wire.error})` : ''}
                  {' · '}
                  Discuss.watch: {ingest.source_counts.discuss?.fetched ?? 0} fetched
                  {ingest.source_counts.discuss?.error ? ` (error: ${ingest.source_counts.discuss.error})` : ''}
                </div>
              )}
              {(ingest.error || (ingest.errors && ingest.errors.length > 0)) && (
                <div className="mt-1.5 coord text-closing">
                  {ingest.error || ingest.errors!.join('; ')}
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
