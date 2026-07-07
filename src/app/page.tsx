import { loadRegistry } from '@/lib/registry';
import { PageHeader } from '@/components/ui';

export default function Home() {
  const { counts } = loadRegistry();
  return (
    <PageHeader
      eyebrow="THE REGISTER"
      title="The funding world, on file."
      sub={`${counts.systems} systems · ${counts.funders} funders · ${counts.programs} programs · ${counts.awards} awards. Placeholder home — the field lands here.`}
    />
  );
}
