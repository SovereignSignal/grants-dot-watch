// Preserve the tested boot implementation and add an explicit later-replay path.
export * from './boot-replay-core';
import { replayAppliedChanges, type BootReplayReport } from './boot-replay-core';

/** Only callers holding this replica's funding-writer lock may refresh after boot.
 * The original boot memoization remains intact for every ordinary boot caller.
 * Replay retains approved, unsynced entries; it never performs Git archival.
 */
export async function refreshAppliedChanges(opts:{root?:string;connectionString?:string}={}):Promise<BootReplayReport> {
  const key=Symbol.for('grants-watch.boot-replay');
  const host=globalThis as unknown as Record<symbol,{inFlight:Promise<BootReplayReport>|null;report:BootReplayReport|null}|undefined>;
  const previous=host[key]?.inFlight;
  if(previous)await previous;
  if(host[key])host[key].inFlight=null;
  return replayAppliedChanges(opts);
}
