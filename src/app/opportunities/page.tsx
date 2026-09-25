import { OpportunityDirectory } from '@/components/opportunities/directory';
import type { SearchParams } from '@/components/ledger/query';
import { pageMetadata } from '@/lib/site-metadata';
export const metadata = pageMetadata('/opportunities', 'Funding opportunities', 'Find grants, fellowships, prizes and funding across crypto, AI and open source.');
export default function Opportunities({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <OpportunityDirectory searchParams={searchParams}/>;
}
