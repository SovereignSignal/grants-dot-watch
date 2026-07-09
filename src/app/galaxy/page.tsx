import type { Metadata } from 'next';
import { loadRegistry } from '@/lib/registry';
import { buildStarmap } from '@/lib/starmap';
import GalaxyCanvas from '@/components/galaxy/GalaxyCanvas';
import GalaxyFallbackList from '@/components/galaxy/GalaxyFallbackList';
import type { GalaxyMeta } from '@/components/galaxy/types';

export const metadata: Metadata = {
  title: 'Galaxy',
  description: 'The full register as a map: systems as clusters, organizations as stars.',
};

function firstParam(v: string | string[] | undefined): string | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

export default async function GalaxyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { systems, orgs, orgStats } = loadRegistry();
  const map = buildStarmap(systems, orgs, orgStats);

  const awardsByOrg: Record<string, number> = {};
  for (const [id, stats] of orgStats) awardsByOrg[id] = stats.awards_given;

  const meta: GalaxyMeta = {
    starCount: map.stars.length,
    clusterCount: map.clusters.length,
    orgCount: orgs.length,
    awardsByOrg,
  };

  const sp = await searchParams;
  const focusOrgId = firstParam(sp.focus);

  return (
    <div className="relative h-[calc(100dvh-56px)] w-full overflow-hidden">
      <GalaxyFallbackList />
      <GalaxyCanvas map={map} meta={meta} focusOrgId={focusOrgId} />
    </div>
  );
}
