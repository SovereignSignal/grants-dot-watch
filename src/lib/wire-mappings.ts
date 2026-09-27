// Identity-only recovery for approved Wire records whose registry file was
// retired. Never replay the retired contents or manufacture a Desk verdict.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { getIngestState, listProposals, setIngestState, withIngestLock } from './desk-store';
import { contentHash } from './research-intake';
import { httpUrl } from './evidence-fields';
import type { Proposal } from './types';

export const WIRE_MAPPING_STATE = 'wire_identity_mappings_v1';
const slug = /^[a-z0-9][a-z0-9-]*$/;
const hash = /^[a-f0-9]{64}$/;
export interface WireMapping {
  wire_id: number; from_program_id: string; to_program_id: string;
  expected_target_hash: string; expected_history_hash: string;
  reason: string; evidence: string[];
}
interface MappingPacket { version: 1; reviewed_by: string; reviewed_at: string; mappings: WireMapping[] }
interface MappingDecision extends WireMapping { reviewed_by: string; reviewed_at: string; target_org: string }
interface MappingState { version: 1; decisions: MappingDecision[] }
export interface MappingTarget { org: string; hash: string }
type ReadTarget = (id: string) => MappingTarget | null;

function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max = 2000): value is string { return typeof value === 'string' && !!value.trim() && value.length <= max; }
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  check(Object.keys(value).every(k => keys.includes(k)), 'Unexpected mapping field');
}
function review(value: Record<string, unknown>) {
  check(text(value.reviewed_by, 200) && typeof value.reviewed_at === 'string'
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value.reviewed_at)
    && Number.isFinite(Date.parse(value.reviewed_at)) && Date.parse(value.reviewed_at) <= Date.now(), 'Invalid mapping review metadata');
}
const mappingKeys = ['wire_id', 'from_program_id', 'to_program_id', 'expected_target_hash', 'expected_history_hash', 'reason', 'evidence'];
function validateMapping(value: unknown, stored = false): asserts value is WireMapping {
  check(object(value), 'Invalid mapping');
  exactKeys(value, [...mappingKeys, ...(stored ? ['reviewed_by', 'reviewed_at', 'target_org'] : [])]);
  check(Number.isSafeInteger(value.wire_id) && Number(value.wire_id) > 0, 'Invalid Wire ID');
  check(typeof value.from_program_id === 'string' && slug.test(value.from_program_id)
    && typeof value.to_program_id === 'string' && slug.test(value.to_program_id)
    && value.from_program_id !== value.to_program_id, 'Invalid mapping program IDs');
  check(typeof value.expected_target_hash === 'string' && hash.test(value.expected_target_hash)
    && typeof value.expected_history_hash === 'string' && hash.test(value.expected_history_hash), 'Mapping requires target and approved-history hashes');
  check(text(value.reason) && Array.isArray(value.evidence) && value.evidence.length > 0 && value.evidence.length <= 20
    && value.evidence.every(v => text(v) && httpUrl(v)), 'Mapping requires a reason and HTTP evidence');
  if (stored) { review(value); check(typeof value.target_org === 'string' && slug.test(value.target_org), 'Invalid mapped organization'); }
}
function parsePacket(value: unknown): MappingPacket {
  check(object(value), 'Invalid mapping packet'); exactKeys(value, ['version', 'reviewed_by', 'reviewed_at', 'mappings']); review(value);
  check(value.version === 1 && Array.isArray(value.mappings) && value.mappings.length > 0 && value.mappings.length <= 200, 'Mapping batch must contain 1 to 200 decisions');
  value.mappings.forEach(v => validateMapping(v));
  check(new Set(value.mappings.map(v => v.wire_id)).size === value.mappings.length, 'Repeated Wire ID in mapping batch');
  return value as unknown as MappingPacket;
}
function parseState(value: unknown): MappingState {
  if (value === null) return { version: 1, decisions: [] };
  check(object(value), 'Invalid stored mappings'); exactKeys(value, ['version', 'decisions']);
  check(value.version === 1 && Array.isArray(value.decisions), 'Invalid stored mappings');
  value.decisions.forEach(v => validateMapping(v, true));
  check(new Set(value.decisions.map(v => v.wire_id)).size === value.decisions.length, 'Conflicting stored mappings');
  return value as unknown as MappingState;
}

function wireId(p: Proposal): number | null {
  const match = /^wire:(\d+)(?::|$)/.exec(String(p.signal_id ?? ''));
  const id = match ? Number(match[1]) : NaN;
  return p.state === 'approved' && Number.isSafeInteger(id) && id > 0 ? id : null;
}
function candidates(proposals: Proposal[]): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const p of proposals) {
    const id = wireId(p); if (id === null) continue;
    const targets = Object.keys(p.proposed_change || {}).filter(k => /^programs\/[a-z0-9][a-z0-9-]*\.yaml$/.test(k));
    if (targets.length !== 1) continue;
    const values = out.get(id) || new Set<string>(); values.add(targets[0].slice(9, -5)); out.set(id, values);
  }
  return out;
}
export function wireHistoryHash(proposals: Proposal[], id: number): string {
  return contentHash(proposals.filter(p => wireId(p) === id)
    .map(p => ({ id: p.id, signal_id: p.signal_id, proposed_change: p.proposed_change }))
    .sort((a, b) => a.id.localeCompare(b.id)));
}
/** Historical approval only. Runtime resolution additionally checks that the
 * target still exists, and applies explicit recovery decisions below. */
export function acceptedWireMappings(proposals: Proposal[]): Map<number, string> {
  return new Map([...candidates(proposals)].filter(([, values]) => values.size === 1).map(([id, values]) => [id, [...values][0]]));
}
export function readMappingTarget(id: string): MappingTarget | null {
  check(slug.test(id), 'Invalid mapping target');
  let bytes: Buffer;
  try { bytes = readFileSync(join(process.cwd(), 'registry', 'programs', `${id}.yaml`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const data = YAML.parse(bytes.toString('utf8'));
  check(data?.id === id && typeof data.org === 'string' && slug.test(data.org), `Invalid registry identity: ${id}`);
  return { org: data.org, hash: createHash('sha256').update(bytes).digest('hex') };
}

export function resolveWireMappings(proposals: Proposal[], stored: unknown, target: ReadTarget): Map<number, string> {
  const state = parseState(stored), result = new Map<number, string>();
  const approved = candidates(proposals);
  for (const [id, values] of approved) {
    const live = [...values].filter(value => target(value));
    if (live.length === 1) result.set(id, live[0]);
    if (live.length) continue; // conflicting surviving approvals require review
    const decision = state.decisions.find(d => d.wire_id === id);
    if (!decision || values.size !== 1 || !values.has(decision.from_program_id)
      || wireHistoryHash(proposals, id) !== decision.expected_history_hash) continue;
    // Ordinary deadline/content edits don't revoke identity. A deletion or
    // change of funder does: the mapping must then be reviewed again.
    if (target(decision.to_program_id)?.org === decision.target_org) result.set(id, decision.to_program_id);
  }
  return result;
}
export async function loadWireMappings(): Promise<Map<number, string>> {
  return resolveWireMappings(await listProposals(undefined, { recoverClaims: false }), await getIngestState(WIRE_MAPPING_STATE), readMappingTarget);
}

export function prepareWireMappings(input: unknown, proposals: Proposal[], stored: unknown, target: ReadTarget) {
  const packet = parsePacket(input), before = parseState(stored), approved = candidates(proposals);
  const additions: MappingDecision[] = [];
  for (const m of packet.mappings) {
    const values = approved.get(m.wire_id);
    check(values?.size === 1 && values.has(m.from_program_id), `Wire ${m.wire_id}: missing or ambiguous historical approval`);
    check(!target(m.from_program_id), `Wire ${m.wire_id}: original program still exists`);
    check(wireHistoryHash(proposals, m.wire_id) === m.expected_history_hash, `Wire ${m.wire_id}: approved history changed`);
    const current = target(m.to_program_id);
    check(current && current.hash === m.expected_target_hash, `Wire ${m.wire_id}: target missing or changed`);
    const decision = { ...m, reviewed_by: packet.reviewed_by, reviewed_at: packet.reviewed_at, target_org: current.org };
    const existing = before.decisions.find(d => d.wire_id === m.wire_id);
    check(!existing || contentHash(existing) === contentHash(decision), `Wire ${m.wire_id}: accepted mapping is immutable; review its history before changing it`);
    if (!existing) additions.push(decision);
  }
  const after: MappingState = { version: 1, decisions: [...before.decisions, ...additions] };
  return { plan_hash: contentHash({ before, packet, after }), additions: additions.length,
    unchanged: packet.mappings.length - additions.length, decisions: packet.mappings, after };
}

const dependencies = { proposals: () => listProposals(undefined, { recoverClaims: false }), getState: getIngestState, setState: setIngestState, target: readMappingTarget, lock: withIngestLock };
export async function reviewWireMappings(input: unknown, opts: { save?: boolean; expectedPlan?: string } = {}, deps = dependencies) {
  const locked = await deps.lock(async () => {
    const plan = prepareWireMappings(input, await deps.proposals(), await deps.getState(WIRE_MAPPING_STATE), deps.target);
    check(!opts.save || opts.expectedPlan === plan.plan_hash, 'Plan changed or expected plan hash missing; preview again');
    // One atomic document update includes both identity and review evidence.
    // No historical proposal, outbox row, registry file or cursor is modified.
    if (opts.save && plan.additions) await deps.setState(WIRE_MAPPING_STATE, plan.after);
    const { after: _after, ...report } = plan; void _after;
    return { ...report, saved: opts.save === true };
  });
  check(locked.ran && locked.result, 'Another intake is running');
  return locked.result;
}
