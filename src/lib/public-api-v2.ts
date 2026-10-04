import { join } from 'node:path';
import { handleFundingRequest } from './funding-api.mjs';
import { readControlledFunding } from './funding-desk-core.mjs';
import { assertFundingRecoveryReady } from './funding-recovery-policy.mjs';
import { lastBootReplayReport } from './boot-replay';
import { loadRegistry } from './registry';

export function serveFundingV2(request: Request, path: string[]) {
  return handleFundingRequest(request, path, {
    enabled: process.env.GRANTS_WATCH_API_V2 === '1',
    load: () => {
      // Even an empty local dataset is unsafe when durable replay failed.
      // Keep the existing site and health page available while v2 fails closed.
      assertFundingRecoveryReady(lastBootReplayReport(), Boolean(process.env.DATABASE_URL));
      return {
        baseline: loadRegistry(),
        dataset: readControlledFunding(join(process.cwd(), 'registry')).dataset,
      };
    },
  });
}
