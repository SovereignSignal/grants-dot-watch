import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { checkAuth } from '@/app/api/desk/lib';
import { listProposals } from './desk-store';
import { isFundingProposal } from './funding-desk-core.mjs';
import { handleFundingWorkspace } from './funding-workspace-service.mjs';
import { captureFundingSource } from './award-source-sweep';
import { loadFundingEditableSnapshot } from './public-api-v2';

export function serveAuthenticatedFundingWorkspace(request: Request) {
  return handleFundingWorkspace(request, {
    authorize: async (req: Request) => (await checkAuth(req)).ok,
    enabled: process.env.GRANTS_WATCH_FUNDING_DESK === '1',
    publicEnabled: process.env.GRANTS_WATCH_API_V2 === '1',
    load: loadFundingEditableSnapshot,
    retained: () => ['batch-001.json', 'batch-002.json'].flatMap(name => {
      const parsed = JSON.parse(readFileSync(join(process.cwd(), 'research/v2/sources', name), 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.snapshots)) throw new Error('invalid_retained_bundle');
      return parsed.snapshots;
    }),
    capture: captureFundingSource,
    pending: async () => (await listProposals({ state: 'pending' })).filter(isFundingProposal).map(p => ({
      id: p.id, title: p.title, program: p.program, state: p.state,
      created_at: p.created_at, proposed_change: p.proposed_change,
    })),
  });
}
