import type { FundingCaptureResult, FundingCaptureDependencies } from './funding-source-native.mjs';

/** Captures supported sections from one bounded, pinned public response. */
export function captureMicrosoftArchive(
  options?: { revision?: string | null },
  dependencies?: FundingCaptureDependencies,
): Promise<FundingCaptureResult>;
