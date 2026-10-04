import { join } from 'node:path';
import { handleFundingRequest } from './funding-api.mjs';
import { readFundingLedgers } from './funding-store.mjs';
import { loadRegistry } from './registry';

// Independent sidecars keep v1 counts, enums, legacy files and loader unchanged.
// No database, secret lookup, source fetch or ingestion occurs on this read path.
export function serveFundingV2(request: Request, path: string[]) {
  return handleFundingRequest(request, path, {
    enabled: process.env.GRANTS_WATCH_API_V2 === '1',
    load: () => ({
      baseline: loadRegistry(),
      dataset: readFundingLedgers(join(process.cwd(), 'registry')),
    }),
  });
}
