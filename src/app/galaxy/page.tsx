import type { Metadata } from 'next';
import GalaxyFallbackList from '@/components/galaxy/GalaxyFallbackList';
import Galaxy3DClient from '@/components/galaxy/Galaxy3DClient';

export const metadata: Metadata = {
  title: 'Galaxy',
  description: 'The full register as a relational map: funders as stars, systems as hubs, co-funding as the edges between them.',
};

function firstParam(v: string | string[] | undefined): string | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

export default async function GalaxyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const focusOrgId = firstParam(sp.focus);

  return (
    <div className="relative h-[calc(100dvh-56px)] w-full overflow-hidden bg-void">
      <GalaxyFallbackList />
      <Galaxy3DClient focusOrgId={focusOrgId} />
    </div>
  );
}
