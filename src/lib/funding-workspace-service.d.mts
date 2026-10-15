/** Type contract for the runtime-validated JavaScript workspace service. */
export interface FundingWorkspaceDependencies {
  authorize: (request: Request) => Promise<boolean>;
  enabled: boolean;
  publicEnabled: boolean;
  load: () => { baseline: unknown; dataset: unknown } | Promise<{ baseline: unknown; dataset: unknown }>;
  retained: () => unknown[];
  capture: (source: string, fund: number, revision: string | null) => Promise<{
    bundle: { snapshots: unknown[] };
    receipt: unknown;
  }>;
  pending: () => Promise<unknown[]>;
  now?: () => Date;
}

export const NATIVE_REFRESH_SOURCES: readonly string[];
export function validateSourceSnapshots<T extends unknown[]>(snapshots: T, today: string): T;
export function compileSourceSnapshots(
  snapshots: unknown[],
  load: FundingWorkspaceDependencies['load'],
  today: string,
): Promise<{ packets: unknown[]; held: unknown[]; [key: string]: unknown }>;

export function handleFundingWorkspace(request: Request, dependencies: FundingWorkspaceDependencies): Promise<Response>;
