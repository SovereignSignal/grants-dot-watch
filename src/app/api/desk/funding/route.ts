import { join } from 'node:path';
import YAML from 'yaml';
import { checkAuth } from '../lib';
import { insertIngestProposals, type RawMinerProposal } from '@/lib/desk-store';
import { handleFundingIntake } from '@/lib/funding-desk-service.mjs';
import { readBaseline } from '@/lib/funding-store.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function POST(request:Request) {
  return handleFundingIntake(request,{
    authorize:async (req:Request)=>(await checkAuth(req)).ok,
    enabled:process.env.GRANTS_WATCH_FUNDING_DESK==='1',
    load:()=>{const root=join(process.cwd(),'registry');return {root,baseline:readBaseline(root,YAML.parse)};},
    enqueue:(rows:unknown[])=>insertIngestProposals(rows as RawMinerProposal[]),
  });
}
