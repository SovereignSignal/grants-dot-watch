import type { Wire } from '@/lib/types';

/** Server-computed context the client canvas needs but shouldn't derive itself. */
export interface GalaxyMeta {
  starCount: number;
  clusterCount: number;
  orgCount: number;
  /** org id -> awards given (funder) or received (grantee), whichever the registry knows. */
  awardsByOrg: Record<string, number>;
}

export type WireFilter = 'all' | Wire;
