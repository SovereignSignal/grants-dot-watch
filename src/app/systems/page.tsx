import type { Metadata } from 'next';
import Link from 'next/link';
import { loadRegistry } from '@/lib/registry';
import { PageHeader, Empty } from '@/components/ui';
import { systemKindLabel } from '@/components/browse/registry-helpers';
import { WIRE_LABEL } from '@/lib/format';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata: Metadata = pageMetadata(
  '/systems',
  'Systems',
  'Browse funding ecosystems and domains across crypto, AI, and open source.'
);

export default function SystemsPage() {
  const { systems, bySystem } = loadRegistry();
  const byId = new Map(systems.map((s) => [s.id, s]));

  return (
    <>
      <PageHeader
        eyebrow="TAXONOMY"
        title="Systems"
        sub="Ecosystems with their own treasury, like Ethereum or Cardano, and the orgs and programs that organize under them."
      />
      <div className="mx-auto max-w-6xl px-4 pb-16">
        {systems.length === 0 ? (
          <Empty>No systems on file.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b-[1.5px] border-paper text-left">
                  <th className="coord py-2.5 pr-4 font-normal">Name</th>
                  <th className="coord py-2.5 pr-4 font-normal">Kind</th>
                  <th className="coord py-2.5 pr-4 font-normal">Wires</th>
                  <th className="coord py-2.5 pr-4 font-normal">Part of</th>
                  <th className="coord py-2.5 pr-4 text-right font-normal">Funders</th>
                  <th className="coord py-2.5 pr-4 text-right font-normal">Programs</th>
                </tr>
              </thead>
              <tbody>
                {systems.map((s) => {
                  const members = bySystem.get(s.id) || { orgs: [], programs: [] };
                  const funderCount = members.orgs.filter((o) => o.roles?.includes('funder')).length;
                  const parents = (s.part_of || []).map((pid) => byId.get(pid)).filter((p): p is NonNullable<typeof p> => !!p);
                  return (
                    <tr key={s.id} className="border-b border-line transition-colors hover:bg-raised/40">
                      <td className="py-3 pr-4">
                        <Link href={`/systems/${s.id}`} className="display text-[14.5px] text-paper hover:text-signal">
                          {s.name}
                        </Link>
                      </td>
                      <td className="coord py-3 pr-4 text-dim normal-case tracking-normal">{systemKindLabel(s.kind)}</td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1.5">
                          {(s.wires || []).map((w) => (
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
                      <td className="coord py-3 pr-4 normal-case tracking-normal">
                        {parents.length === 0 ? (
                          <span className="text-faint">–</span>
                        ) : (
                          parents.map((p, i) => (
                            <span key={p.id}>
                              {i > 0 && ', '}
                              <Link href={`/systems/${p.id}`} className="text-dim hover:text-paper">
                                {p.name}
                              </Link>
                            </span>
                          ))
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right font-bold tabular-nums text-paper">{funderCount}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-dim">{members.programs.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
