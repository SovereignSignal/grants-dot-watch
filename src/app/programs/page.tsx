import { OpportunityDirectory } from '@/components/opportunities/directory';
import type { SearchParams } from '@/components/ledger/query';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('/programs', 'Programs', 'Find funding programs across crypto, AI and open source, with current calls and calendar history.');
export default function ProgramsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <OpportunityDirectory searchParams={searchParams}/>;
}
