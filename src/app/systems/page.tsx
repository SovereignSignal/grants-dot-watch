import type { Metadata } from 'next';
import { loadRegistry } from '@/lib/registry';
import { PageHeader, Card, WireBadge, Empty, Coord } from '@/components/ui';
import { systemKindLabel, firstSentence } from '@/components/browse/registry-helpers';

export const metadata: Metadata = { title: 'Systems' };

export default function SystemsPage() {
  const { systems, bySystem } = loadRegistry();
  const byId = new Map(systems.map((s) => [s.id, s]));

  return (
    <>
      <PageHeader
        eyebrow="TAXONOMY"
        title="Systems"
        sub="The funding ecosystems: each with its own treasury or allocating identity, and the orgs and programs that organize under it."
      />
      <div className="mx-auto max-w-6xl px-4 pb-16">
        {systems.length === 0 ? (
          <Empty>No systems on file.</Empty>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {systems.map((s) => {
              const members = bySystem.get(s.id) || { orgs: [], programs: [] };
              const funderCount = members.orgs.filter((o) => o.roles?.includes('funder')).length;
              const parents = (s.part_of || []).map((pid) => byId.get(pid)).filter((p): p is NonNullable<typeof p> => !!p);
              return (
                <Card key={s.id} href={`/systems/${s.id}`} className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="display text-lg font-semibold tracking-tight">{s.name}</h2>
                  </div>
                  <div className="coord">
                    {systemKindLabel(s.kind)}
                    {parents.length > 0 && <> · satellite of {parents.map((p) => p.name).join(', ')}</>}
                  </div>
                  {s.wires?.length > 0 && (
                    <div className="flex flex-wrap gap-3">
                      {s.wires.map((w) => (
                        <WireBadge key={w} wire={w} small />
                      ))}
                    </div>
                  )}
                  <Coord>
                    {funderCount} funder{funderCount === 1 ? '' : 's'} · {members.programs.length} program
                    {members.programs.length === 1 ? '' : 's'}
                  </Coord>
                  {s.summary && <p className="text-sm text-dim">{firstSentence(s.summary)}</p>}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
