import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { checkAuth } from '@/app/api/desk/lib';
import { listProposals } from './desk-store';
import { isFundingProposal } from './funding-desk-core.mjs';
import { handleFundingWorkspace } from './funding-workspace-service.mjs';
import { captureMicrosoftFund } from './funding-source-native.mjs';
import { captureMicrosoftArchive } from './funding-source-native-batch.mjs';
import { captureFundingTable } from './funding-source-html.mjs';
import { loadFundingEditableSnapshot } from './public-api-v2';

const captures = new Map<string, { active: boolean; starts: number[] }>();
async function capture(source: string, fund: number, revision: string | null) {
  const now = Date.now(), state = captures.get(source) || { active: false, starts: [] };
  state.starts = state.starts.filter(t => now - t < 60_000);
  if (state.active || state.starts.length >= 4) throw new Error('source_capture_busy');
  state.active = true; state.starts.push(now); captures.set(source, state);
  try {
    if (source === 'microsoft-foss') return fund === 0
      ? await captureMicrosoftArchive({ revision })
      : await captureMicrosoftFund({ fund, revision });
    return await captureFundingTable(source);
  } finally { state.active = false; }
}

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
    capture,
    pending: async () => (await listProposals({ state: 'pending' })).filter(isFundingProposal).map(p => ({
      id: p.id, title: p.title, program: p.program, state: p.state,
      created_at: p.created_at, proposed_change: p.proposed_change,
    })),
  });
}
