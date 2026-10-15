/** Type contract for the runtime-validated clean award packet rule. */
export function packRecords(pack: unknown): Array<{ ledger: string; row: Record<string, unknown> }> | null;
export function packetReasons(input: { source: string; compiled: unknown; pack: unknown; preview: unknown }): string[];
export function mappingReasons(source: string, pack: unknown, baseline: unknown): string[];
