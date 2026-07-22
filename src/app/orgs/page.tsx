import type { Metadata } from 'next';
import Link from 'next/link';
import { loadRegistry } from '@/lib/registry';
import { PageHeader, Empty } from '@/components/ui';
import { OrgFilterBar, type OrgFilterState } from '@/components/browse/filters';
import { ORG_ROLE_LABEL, ORG_STATUS_LABEL, orgTypeLabel } from '@/components/browse/registry-helpers';
import { WIRE_LABEL, dateShort } from '@/lib/format';
import type { Org, Wire } from '@/lib/types';
import { paginate, paginationItems, parsePage } from '@/lib/pagination';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata: Metadata = pageMetadata(
  '/orgs',
  'Organizations',
  'Browse funding organizations across crypto, AI, and open source.'
);

const ROLE_OPTIONS: Org['roles'][number][] = ['funder', 'grantee', 'ecosystem'];
const WIRE_OPTIONS: Wire[] = ['crypto', 'ai', 'oss'];
const STATUS_OPTIONS: Org['status'][] = ['active', 'winding-down', 'dormant', 'dead', 'unknown'];
const PAGE_SIZE = 50;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function pageHref(current: OrgFilterState, page: number): string {
  const params = new URLSearchParams();
  if (current.role) params.set('role', current.role);
  if (current.wire) params.set('wire', current.wire);
  if (current.system) params.set('system', current.system);
  if (current.status) params.set('status', current.status);
  if (current.q) params.set('q', current.q);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/orgs?${query}` : '/orgs';
}

export default async function OrgsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const current: OrgFilterState = {
    role: first(sp.role),
    wire: first(sp.wire),
    system: first(sp.system),
    status: first(sp.status),
    q: first(sp.q),
  };

  const registry = loadRegistry();
  const systemById = new Map(registry.systems.map((s) => [s.id, s]));

  let list = registry.orgs;
  if (current.role) list = list.filter((o) => o.roles?.includes(current.role as Org['roles'][number]));
  if (current.wire) list = list.filter((o) => o.wires?.includes(current.wire as Wire));
  if (current.system) list = list.filter((o) => o.systems?.includes(current.system!));
  if (current.status) list = list.filter((o) => o.status === current.status);
  if (current.q) {
    const needle = current.q.toLowerCase();
    list = list.filter((o) => o.name.toLowerCase().includes(needle) || (o.aka || []).some((a) => a.toLowerCase().includes(needle)));
  }

  const sorted = [...list].sort((a, b) => {
    const sa = registry.orgStats.get(a.id)?.programs || 0;
    const sb = registry.orgStats.get(b.id)?.programs || 0;
    return sb - sa || a.name.localeCompare(b.name);
  });

  const page = paginate(sorted, parsePage(first(sp.page)), PAGE_SIZE);
  const rows = page.items;

  const systemOptions = registry.systems
    .filter((s) => (registry.bySystem.get(s.id)?.orgs.length || 0) > 0)
    .map((s) => ({ value: s.id, label: s.name }));

  return (
    <>
      <PageHeader eyebrow="THE REGISTER" title="Organizations" sub="Every org grants.watch tracks: funders curated in depth, others as thin records." />
      <OrgFilterBar
        current={current}
        roleOptions={ROLE_OPTIONS.map((r) => ({ value: r, label: ORG_ROLE_LABEL[r] }))}
        wireOptions={WIRE_OPTIONS.map((w) => ({ value: w, label: WIRE_LABEL[w] }))}
        systemOptions={systemOptions}
        statusOptions={STATUS_OPTIONS.map((s) => ({ value: s, label: ORG_STATUS_LABEL[s] }))}
      />
      <div className="mx-auto max-w-6xl px-4 pb-16">
        <div className="coord border-b border-line py-3">
          {page.total === 0
            ? 'no organizations match'
            : `showing ${page.start}-${page.end} of ${page.total} · page ${page.page} of ${page.totalPages}`}
        </div>
        {page.total === 0 ? (
          <Empty>No organizations match these filters.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b-[1.5px] border-paper text-left">
                  <th className="coord py-2.5 pr-4 font-normal">Name</th>
                  <th className="coord py-2.5 pr-4 font-normal">Type</th>
                  <th className="coord py-2.5 pr-4 font-normal">Systems</th>
                  <th className="coord py-2.5 pr-4 font-normal">Wires</th>
                  <th className="coord py-2.5 pr-4 text-right font-normal">Programs</th>
                  <th className="coord py-2.5 pr-4 text-right font-normal">Open now</th>
                  <th className="coord py-2.5 pr-4 text-right font-normal">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const stats = registry.orgStats.get(o.id);
                  const sys = (o.systems || []).map((id) => systemById.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
                  const shown = sys.slice(0, 2);
                  const extra = sys.length - shown.length;
                  return (
                    <tr key={o.id} className="border-b border-line transition-colors hover:bg-raised/40">
                      <td className="py-3 pr-4">
                        <Link href={`/orgs/${o.id}`} className="display text-[14.5px] text-paper hover:text-signal">
                          {o.name}
                        </Link>
                      </td>
                      <td className="coord py-3 pr-4 text-dim normal-case tracking-normal">{orgTypeLabel(o)}</td>
                      <td className="coord py-3 pr-4 normal-case tracking-normal">
                        {shown.length === 0 ? (
                          <span className="text-faint">–</span>
                        ) : (
                          <>
                            {shown.map((s, i) => (
                              <span key={s.id}>
                                {i > 0 && ', '}
                                <Link href={`/systems/${s.id}`} className="text-dim hover:text-paper">
                                  {s.name}
                                </Link>
                              </span>
                            ))}
                            {extra > 0 && <span className="text-faint"> +{extra}</span>}
                          </>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1.5">
                          {(o.wires || []).map((w) => (
                            <span
                              key={w}
                              aria-label={WIRE_LABEL[w]}
                              title={WIRE_LABEL[w]}
                              className="inline-block size-1.5 shrink-0"
                              style={{ background: `var(--color-${w})` }}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right font-bold tabular-nums text-paper">{stats?.programs ?? 0}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-dim">{stats?.live_rounds ?? 0}</td>
                      <td className="py-3 pr-4 text-right text-[12px] tabular-nums text-faint">{dateShort(stats?.last_activity)}</td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
            {page.totalPages > 1 && (
              <nav aria-label="Organization pages" className="coord flex flex-wrap items-center justify-between gap-4 border-t border-line py-4">
                {page.page > 1 ? (
                  <Link href={pageHref(current, page.page - 1)} className="text-dim hover:text-paper">
                    ← Previous
                  </Link>
                ) : (
                  <span aria-disabled="true" className="text-faint">← Previous</span>
                )}
                <div className="flex flex-wrap items-center justify-center gap-1">
                  {paginationItems(page.page, page.totalPages).map((item, index) =>
                    item === 'ellipsis' ? (
                      <span key={`ellipsis-${index}`} aria-hidden className="inline-flex size-8 items-center justify-center text-faint">
                        ...
                      </span>
                    ) : (
                      <Link
                        key={item}
                        href={pageHref(current, item)}
                        aria-current={item === page.page ? 'page' : undefined}
                        className={`inline-flex size-8 items-center justify-center border transition-colors ${
                          item === page.page
                            ? 'border-paper bg-paper text-void'
                            : 'border-line text-dim hover:border-paper hover:text-paper'
                        }`}
                      >
                        {item}
                      </Link>
                    )
                  )}
                </div>
                {page.page < page.totalPages ? (
                  <Link href={pageHref(current, page.page + 1)} className="text-dim hover:text-paper">
                    Next →
                  </Link>
                ) : (
                  <span aria-disabled="true" className="text-faint">Next →</span>
                )}
              </nav>
            )}
          </>
        )}
      </div>
    </>
  );
}
