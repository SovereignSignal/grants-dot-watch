import Link from 'next/link';
import { loadRegistry } from '@/lib/registry';
import { PageHeader, Card, RoundStatus, Empty, Stat } from '@/components/ui';
import { dateShort, WIRE_LABEL } from '@/lib/format';
import type { Wire } from '@/lib/types';
import { param, hrefWith, type SearchParams, type Query } from '@/components/ledger/query';
import { ChipRow, FilterChip, ActiveFilterChip } from '@/components/ledger/chip';
import { MECHANISM_LABEL, PROGRAM_STATUS_LABEL } from '@/components/ledger/labels';
import { mostLiveRound, programRank } from '@/components/ledger/rounds';

const STATUS_ORDER = ['active', 'announced', 'paused', 'concluded', 'unknown'];
const MECHANISM_ORDER = ['grants', 'retro', 'quadratic', 'prize', 'fellowship', 'incubator', 'rfp', 'other'];
const WIRE_ORDER: Wire[] = ['crypto', 'ai', 'oss'];

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

  const { programs, orgs } = loadRegistry();
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  let filtered = programs;
  if (statusF) filtered = filtered.filter((p) => p.status === statusF);
  if (mechF) filtered = filtered.filter((p) => (p.mechanism || 'other') === mechF);
  if (wireF) filtered = filtered.filter((p) => (p.wires || []).includes(wireF as Wire));
  if (orgF) filtered = filtered.filter((p) => p.org === orgF);

  const sorted = [...filtered].sort((a, b) => {
    const ra = programRank(a.rounds);
    const rb = programRank(b.rounds);
    if (ra !== rb) return ra - rb;
    if (ra === 0) {
      const ca = mostLiveRound(a.rounds)?.closes || '';
      const cb = mostLiveRound(b.rounds)?.closes || '';
      if (ca && cb && ca !== cb) return ca.localeCompare(cb);
      if (ca && !cb) return -1;
      if (!ca && cb) return 1;
    }
    return a.name.localeCompare(b.name);
  });

  const query: Query = { status: statusF, mechanism: mechF, wire: wireF, org: orgF };
  const statusValues = uniqueInOrder(programs.map((p) => p.status), STATUS_ORDER);
  const mechValues = uniqueInOrder(programs.map((p) => p.mechanism || 'other'), MECHANISM_ORDER);
  const wireValues = uniqueInOrder(programs.flatMap((p) => p.wires || []), WIRE_ORDER);
  const orgFilterName = orgF ? orgById.get(orgF)?.name || orgF : null;

  return (
    <>
      <PageHeader
        eyebrow="FUNDING VEHICLES"
        title="Programs"
        right={<Stat label="on file" value={sorted.length.toLocaleString()} />}
      />
      <div className="mx-auto max-w-6xl px-4 space-y-3 pb-6">
        {statusValues.length > 1 && (
          <ChipRow>
            {statusValues.map((v) => (
              <FilterChip key={v} href={hrefWith('/programs', query, { status: statusF === v ? undefined : v })} active={statusF === v}>
                {PROGRAM_STATUS_LABEL[v] || v}
              </FilterChip>
            ))}
          </ChipRow>
        )}
        {mechValues.length > 1 && (
          <ChipRow>
            {mechValues.map((v) => (
              <FilterChip key={v} href={hrefWith('/programs', query, { mechanism: mechF === v ? undefined : v })} active={mechF === v}>
                {MECHANISM_LABEL[v] || v}
              </FilterChip>
            ))}
          </ChipRow>
        )}
        {wireValues.length > 1 && (
          <ChipRow>
            {wireValues.map((v) => (
              <FilterChip key={v} href={hrefWith('/programs', query, { wire: wireF === v ? undefined : v })} active={wireF === v}>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: `var(--color-${v})` }} />
                  {WIRE_LABEL[v]}
                </span>
              </FilterChip>
            ))}
          </ChipRow>
        )}
        {orgFilterName && (
          <ChipRow>
            <ActiveFilterChip href={hrefWith('/programs', query, { org: undefined })}>Org: {orgFilterName}</ActiveFilterChip>
          </ChipRow>
        )}
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-16">
        {sorted.length === 0 ? (
          <Empty>No programs on file for this filter yet.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sorted.map((p) => {
              const org = orgById.get(p.org);
              const round = mostLiveRound(p.rounds);
              return (
                <Card key={p.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/programs/${p.id}`} className="display block truncate text-lg font-semibold hover:text-signal transition-colors">
                        {p.name}
                      </Link>
                      {org ? (
                        <Link href={`/orgs/${org.id}`} className="coord hover:text-dim">
                          {org.name}
                        </Link>
                      ) : (
                        <span className="coord opacity-60">{p.org}</span>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      {round ? (
                        <>
                          <RoundStatus status={round.status} />
                          {round.closes && <div className="coord mt-1">closes {dateShort(round.closes)}</div>}
                        </>
                      ) : (
                        <span className="coord opacity-50">no rounds on file</span>
                      )}
                    </div>
                  </div>
                  <div className="coord mt-2">{MECHANISM_LABEL[p.mechanism || 'other'] || p.mechanism}</div>
                  {p.summary?.trim() && <p className="mt-2 line-clamp-1 text-sm text-dim">{p.summary.trim()}</p>}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
