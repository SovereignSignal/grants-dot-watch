/** Type contract for the runtime-validated JavaScript workspace service. */
export interface FundingWorkspaceDependencies {
  authorize: (request: Request) => Promise<boolean>;
  enabled: boolean;
  publicEnabled: boolean;
  load: () => { baseline: unknown; dataset: unknown };
  retained: () => unknown[];
  capture: (source: string, fund: number, revision: string | null) => Promise<{
    bundle: { snapshots: unknown[] };
    receipt: unknown;
  }>;
  pending: () => Promise<unknown[]>;
  now?: () => Date;
}

/** Authentication precedes body reads, source requests and registry reads. */
export function handleFundingWorkspace(
  request: Request,
  dependencies: FundingWorkspaceDependencies,
): Promise<Response>;
