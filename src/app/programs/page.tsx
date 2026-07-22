import type { Metadata } from 'next';
import { loadRegistry } from '@/lib/registry';
import { PageHeader, Stat } from '@/components/ui';
import type { Wire } from '@/lib/types';
import { param, hrefWith, type SearchParams, type Query } from '@/components/ledger/query';
import { MECHANISM_LABEL, PROGRAM_STATUS_LABEL } from '@/components/ledger/labels';
import { WIRE_LABEL } from '@/lib/format';
import { FilterRow, FilterLink, ActiveFilterLink } from '@/components/ui-filters';
import { ProgramsTabs, type ProgramsView } from '@/components/programs/tabs';
import { DeparturesBoard } from '@/components/programs/departures-board';
import { CadenceChart } from '@/components/programs/cadence-chart';
import { pageMetadata } from '@/lib/site-metadata';
import { hasYearCadence } from '@/lib/cadence';
import { paginate, parsePage } from '@/lib/pagination';
import { collectCurrentDepartures } from '@/lib/departures';
import { Pager } from '@/components/ledger/pager';
import { productDateISO, productYear } from '@/lib/round-state';

export const metadata: Metadata = pageMetadata(
  '/programs',
  'Programs',
  'Track open calls, deadlines, and funding cadence across every program in the registry.'
);

const STATUS_ORDER = ['active', 'announced', 'paused', 'concluded', 'unknown'];
const MECHANISM_ORDER = ['grants', 'retro', 'quadratic', 'prize', 'fellowship', 'incubator', 'rfp', 'other'];
const WIRE_ORDER: Wire[] = ['crypto', 'ai', 'oss'];
const DEPARTURES_PAGE_SIZE = 50;
const CADENCE_PAGE_SIZE = 60;

function uniqueInOrder<T extends string>(values: T[], order: T[]): T[] {
  const present = new Set(values);
  return order.filter((v) => present.has(v));
}

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const statusF = param(sp, 'status');
  const mechF = param(sp, 'mechanism');
  const wireF = param(sp, 'wire');
  const orgF = param(sp, 'org');
  const cadenceScope = param(sp, 'scope') === 'all' ? 'all' : 'current';
  const viewParam = param(sp, 'view');
  const view: ProgramsView = viewParam === 'cadence' ? 'cadence' : 'departures';

  const { programs, orgs, systems } = loadRegistry();
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  // Same filter logic the board carried before this phase — status/mechanism/
  // wire/org narrow the program set; both tabs read from that one filtered
  // list, so a filter set on one view still holds when you switch to the other.
  let filtered = programs;
  if (statusF) filtered = filtered.filter((p) => p.status === statusF);
  if (mechF) filtered = filtered.filter((p) => (p.mechanism || 'other') === mechF);
  if (wireF) filtered = filtered.filter((p) => (p.wires || []).includes(wireF as Wire));
  if (orgF) filtered = filtered.filter((p) => p.org === orgF);

  const query: Query = { status: statusF, mechanism: mechF, wire: wireF, org: orgF, view: viewParam, scope: cadenceScope === 'all' ? 'all' : undefined };
  const statusValues = uniqueInOrder(programs.map((p) => p.status), STATUS_ORDER);
  const mechValues = uniqueInOrder(programs.map((p) => p.mechanism || 'other'), MECHANISM_ORDER);
  const wireValues = uniqueInOrder(programs.flatMap((p) => p.wires || []), WIRE_ORDER);
  const orgFilterName = orgF ? orgById.get(orgF)?.name || orgF : null;
  const year = productYear();
  const todayISO = productDateISO();
  const departures = collectCurrentDepartures(filtered, orgs, todayISO);
  const departuresPage = paginate(departures, parsePage(param(sp, 'page')), DEPARTURES_PAGE_SIZE);
  const cadenceFiltered = cadenceScope === 'all' ? filtered : filtered.filter((program) => hasYearCadence(program, year));
  const cadencePage = paginate(cadenceFiltered, parsePage(param(sp, 'page')), CADENCE_PAGE_SIZE);
  const visibleCount = view === 'cadence' ? cadencePage.total : departuresPage.total;

  return (
    <>
      <PageHeader
        eyebrow="Funding Vehicles"
        title="Programs"
        sub="What closes next across every program we track. The year's rhythm, plotted lane by lane."
        right={<Stat label={view === 'cadence' ? 'in this cadence' : 'open calls'} value={visibleCount.toLocaleString()} />}
      />

      <div className="mx-auto max-w-6xl px-4 pt-5">
        <ProgramsTabs active={view} query={query} />
      </div>

      {view === 'departures' && (
        <div className="mx-auto max-w-6xl px-4 pb-1">
          {statusValues.length > 1 && (
            <FilterRow label="Status">
              {statusValues.map((v) => (
                <FilterLink
                  key={v}
                  href={hrefWith('/programs', query, { status: statusF === v ? undefined : v })}
                  active={statusF === v}
                >
                  {PROGRAM_STATUS_LABEL[v] || v}
                </FilterLink>
              ))}
            </FilterRow>
          )}
          {mechValues.length > 1 && (
            <FilterRow label="Mechanism">
              {mechValues.map((v) => (
                <FilterLink
                  key={v}
                  href={hrefWith('/programs', query, { mechanism: mechF === v ? undefined : v })}
                  active={mechF === v}
                >
                  {MECHANISM_LABEL[v] || v}
                </FilterLink>
              ))}
            </FilterRow>
          )}
          {wireValues.length > 1 && (
            <FilterRow label="Wire">
              {wireValues.map((v) => (
                <FilterLink key={v} href={hrefWith('/programs', query, { wire: wireF === v ? undefined : v })} active={wireF === v}>
                  {WIRE_LABEL[v]}
                </FilterLink>
              ))}
            </FilterRow>
          )}
          {orgFilterName && (
            <FilterRow label="Organization">
              <ActiveFilterLink href={hrefWith('/programs', query, { org: undefined })}>{orgFilterName}</ActiveFilterLink>
            </FilterRow>
          )}
          <div className="coord border-t border-line py-2.5">
            {departuresPage.total === 0
              ? 'no open calls match'
              : `showing ${departuresPage.start}-${departuresPage.end} of ${departuresPage.total.toLocaleString()} open calls`}
          </div>
        </div>
      )}

      {view === 'cadence' && (
        <div className="mx-auto max-w-6xl px-4 pb-1">
          <FilterRow label="Coverage">
            <FilterLink
              href={hrefWith('/programs', query, { scope: undefined })}
              active={cadenceScope === 'current'}
            >
              {year} + rolling
            </FilterLink>
            <FilterLink
              href={hrefWith('/programs', query, { scope: 'all' })}
              active={cadenceScope === 'all'}
            >
              Include all programs
            </FilterLink>
          </FilterRow>
          <div className="coord border-t border-line py-2.5">
            {cadencePage.total === 0
              ? 'no programs in this cadence'
              : `showing ${cadencePage.start}-${cadencePage.end} of ${cadencePage.total.toLocaleString()}`}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 pb-16">
        {view === 'departures' ? (
          <>
            <DeparturesBoard departures={departuresPage.items} />
            <Pager base="/programs" query={query} page={departuresPage.page} pageCount={departuresPage.totalPages} />
          </>
        ) : (
          <>
            <CadenceChart programs={cadencePage.items} orgs={orgs} systems={systems} />
            <Pager base="/programs" query={query} page={cadencePage.page} pageCount={cadencePage.totalPages} />
          </>
        )}
      </div>
    </>
  );
}
