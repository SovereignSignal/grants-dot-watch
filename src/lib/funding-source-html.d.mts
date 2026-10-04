import type { FundingCaptureResult, FundingCaptureDependencies } from './funding-source-native.mjs';

export const HTML_SOURCES: string[];
export function selectFundingTable(html: string, source: string): { body: string; rows: number };
/** Captures only a fixed reviewed source URL; source schemas validate at runtime. */
export function captureFundingTable(
  source: string,
  dependencies?: FundingCaptureDependencies,
): Promise<FundingCaptureResult>;
