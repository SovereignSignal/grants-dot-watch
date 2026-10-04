/** Explicit TypeScript boundary for the runtime-validated native source client. */
export interface FundingCaptureResult {
  bundle: { version: number; snapshots: unknown[] };
  receipt: Record<string, unknown>;
}
export interface FundingCaptureDependencies {
  request?: typeof fetch;
  now?: () => Date;
}
export function captureMicrosoftFund(
  options?: { fund?: number; revision?: string | null },
  dependencies?: FundingCaptureDependencies,
): Promise<FundingCaptureResult>;
