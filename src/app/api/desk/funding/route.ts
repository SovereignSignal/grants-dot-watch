import { checkAuth } from '../lib';
import { insertIngestProposals, type RawMinerProposal } from '@/lib/desk-store';
import { handleFundingIntake } from '@/lib/funding-desk-service.mjs';
import { loadFundingEditableSnapshot } from '@/lib/public-api-v2';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function POST(request:Request) {
  return handleFundingIntake(request,{
    authorize:async (req:Request)=>(await checkAuth(req)).ok,
    enabled:process.env.GRANTS_WATCH_FUNDING_DESK==='1',
    load:loadFundingEditableSnapshot,
    enqueue:(rows:unknown[])=>insertIngestProposals(rows as RawMinerProposal[]),
  });
}
