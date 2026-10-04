import { join } from 'node:path';
import { handleFundingRequest } from './funding-api.mjs';
import { readControlledFunding } from './funding-desk-core.mjs';
import { loadRegistry } from './registry';

export function serveFundingV2(request: Request, path: string[]) {
  return handleFundingRequest(request, path, {
    enabled: process.env.GRANTS_WATCH_API_V2 === '1',
    load: () => ({
      baseline: loadRegistry(),
      dataset: readControlledFunding(join(process.cwd(), 'registry')).dataset,
    }),
  });
}
