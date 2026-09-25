import type { Metadata } from 'next';
import { loadRegistry } from '@/lib/registry';
import { Card, Empty, PageHeader } from '@/components/ui';
import { firstSentence } from '@/components/browse/registry-helpers';
import { WIRE_LABEL } from '@/lib/format';
import { pageMetadata } from '@/lib/site-metadata';
import type { System } from '@/lib/types';

export const metadata: Metadata = pageMetadata(
  '/systems',
  'Systems',
  'Browse funding ecosystems and domains across crypto, AI, and active source.'
);

const KIND_ORDER: System['kind'][] = ['protocol-ecosystem', 'funding-domain'];
const KIND_TITLE: Record<System['kind'], string> = {
  'protocol-ecosystem': 'Protocol ecosystems',
  'funding-domain': 'Funding domains',
};
const KIND_INTRO: Record<System['kind'], string> = {
  'protocol-ecosystem': 'Blockchains with their own foundations, treasuries and grant programs.',
  'funding-domain': 'Fields of work funded by several organizations.',
};

export default function SystemsPage() {
  const { systems, bySystem } = loadRegistry();
  const byId = new Map(systems.map((s) => [s.id, s]));

  const rows = systems.map((system) => {
    const members = bySystem.get(system.id) || { orgs: [], programs: [] };
    const funderCount = members.orgs.filter((o) => o.roles?.includes('funder')).length;
    const activeCount = members.programs.filter((program) => program.status === 'active').length;
    const parents = (system.part_of || []).map((pid) => byId.get(pid)).filter((p): p is NonNullable<typeof p> => !!p);
    return {
      system,
      funderCount,
      programCount: members.programs.length,
      activeCount,
      parents,
    };
  });

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: rows
      .filter((row) => row.system.kind === kind)
      .sort((a, b) => b.programCount - a.programCount || a.system.name.localeCompare(b.system.name)),
  })).filter((group) => group.items.length > 0);

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
          <div className="flex flex-col gap-12">
            {groups.map((group) => (
              <section key={group.kind}>
                <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
                  <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">{KIND_TITLE[group.kind]}</h2>
                  <span className="coord shrink-0">{group.items.length} on file</span>
                </div>
                <p className="coord mt-2 mb-1">{KIND_INTRO[group.kind]}</p>
                <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
                  {group.items.map((row) => (
                    <Card key={row.system.id} href={`/systems/${row.system.id}`}>
                      <div className="coord mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {(row.system.wires || []).map((wire) => (
                          <span key={wire} className="inline-flex items-center gap-1.5">
                            <span aria-hidden className="inline-block size-1.5 shrink-0" style={{ background: `var(--color-${wire})` }} />
                            {WIRE_LABEL[wire]}
                          </span>
                        ))}
                      </div>
                      <h3 className="display text-[22px] leading-tight text-paper">{row.system.name}</h3>
                      {row.parents.length > 0 && (
                        <div className="coord mt-1">Part of {row.parents.map((parent) => parent.name).join(', ')}</div>
                      )}
                      <p className="mt-3 text-sm leading-relaxed text-dim">
                        {firstSentence(row.system.summary) || 'No public summary on file yet.'}
                      </p>
                      <div className="coord mt-4 flex flex-wrap gap-x-3 gap-y-1">
                        <span>{row.funderCount} funders</span>
                        <span>{row.programCount} programs</span>
                        <span>{row.activeCount} active now</span>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
