import { join } from 'node:path';
import { handleFundingProductRequest, buildFundingProduct } from './funding-product.mjs';
import { readControlledFunding } from './funding-desk-core.mjs';
import { assertFundingRecoveryReady } from './funding-recovery-policy.mjs';
import { lastBootReplayReport } from './boot-replay';
import { loadRegistry } from './registry';

export function loadFundingReadSnapshot() {
  assertFundingRecoveryReady(lastBootReplayReport(), Boolean(process.env.DATABASE_URL));
  return {
    baseline: loadRegistry(),
    dataset: readControlledFunding(join(process.cwd(), 'registry')).dataset,
  };
}

export function loadPublicFundingProduct() {
  if (process.env.GRANTS_WATCH_API_V2 !== '1') return null;
  const { baseline, dataset } = loadFundingReadSnapshot();
  return buildFundingProduct(baseline, dataset);
}

export function serveFundingV2(request: Request, path: string[]) {
  return handleFundingProductRequest(request, path, {
    enabled: process.env.GRANTS_WATCH_API_V2 === '1',
    load: loadFundingReadSnapshot,
  });
}
