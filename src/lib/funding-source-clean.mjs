// The "clean award packet" rule for the daily award-source sweep. Pure: it
// reads only what the compiler and preview already produced, never writes,
// queues or approves. Any condition it cannot establish from those outputs
// makes the packet not clean. An empty reason list is the only clean result.
import { LEDGERS } from './funding-model.mjs';
import { MAX_PACK_BYTES, MAX_PACK_RECORDS } from './funding-desk-core.mjs';
import { SOURCE_CATALOG } from './funding-source-adapters.mjs';
import { SOURCE_PACKET_BYTE_LIMIT } from './funding-source-packets.mjs';
import { NATIVE_REFRESH_SOURCES } from './funding-workspace-service.mjs';

/** Mirrors the NumFOCUS adapter's joint-beneficiary test, so a joint row that
 *  ever reached a packet is still caught here. */
const JOINT_NAME = /,|\s&\s|\s\/\s/;
const DIGEST = /^[a-f0-9]{64}$/;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sum = counts => (plain(counts) ? Object.values(counts).reduce((n, v) => n + (Number(v) || 0), 0) : NaN);
const orgFields = row => [row.funder, row.operator_org, row.disburser_org, ...(Array.isArray(row.capital_source_orgs) ? row.capital_source_orgs : [])].filter(v => v != null);

/** Records in a pack, or null when the pack does not have the compiler's shape. */
export function packRecords(pack) {
  if (!plain(pack) || !plain(pack.records)) return null;
  const rows = [];
  for (const ledger of LEDGERS) {
    if (!Array.isArray(pack.records[ledger])) return null;
    for (const row of pack.records[ledger]) rows.push({ ledger, row });
  }
  return rows;
}

/**
 * Conditions decidable from the sweep's own outputs, before any re-read.
 * @param {{source:string, compiled:any, pack:any, preview:any}} input
 * @returns {string[]} reasons the packet is not clean; empty when clean
 */
export function packetReasons({ source, compiled, pack, preview }) {
  const reasons = new Set();
  const config = Object.hasOwn(SOURCE_CATALOG, source) ? SOURCE_CATALOG[source] : null;
  // 1. An allowlisted first-party source with a native capture client.
  if (!config || !NATIVE_REFRESH_SOURCES.includes(source)) reasons.add('source_not_allowlisted');
  // 2. The capture compiled whole: no failed snapshot, no coverage gap, no held record.
  if (!plain(compiled) || !Array.isArray(compiled.held) || !Array.isArray(compiled.source_failures) || !Array.isArray(compiled.coverage_gaps)) {
    reasons.add('compile_output_unknown');
  } else {
    if (compiled.source_failures.length) reasons.add('source_failures');
    if (compiled.coverage_gaps.length) reasons.add('coverage_gaps');
    // Held reasons name the duplicate, identity, joint-beneficiary, mapping and
    // supersession checks; each one keeps the whole source on the Desk.
    for (const item of compiled.held) reasons.add(`held_records:${typeof item?.reason === 'string' ? item.reason : 'unknown'}`);
  }
  // 3. The pack is the compiler's shape and within the Desk and packet limits.
  const rows = packRecords(pack);
  if (!rows) return [...reasons, 'pack_shape_unknown'];
  const bytes = Buffer.byteLength(JSON.stringify(pack));
  if (!rows.length || rows.length > MAX_PACK_RECORDS || bytes > MAX_PACK_BYTES || bytes > SOURCE_PACKET_BYTE_LIMIT) reasons.add('pack_limits');
  if (pack.records['program-terms'].length) reasons.add('program_terms_not_auto');
  for (const { ledger, row } of rows) {
    if (!plain(row) || typeof row.key !== 'string') { reasons.add('record_shape_unknown'); continue; }
    if (config && row.program !== config.program) reasons.add('program_mapping_mismatch');
    if (row.supersedes_key != null || row.legacy_award_key != null) reasons.add('supersedes_existing_key');
    if (ledger === 'funding-events') {
      if (config && row.funder !== config.issuer) reasons.add('issuer_mapping_mismatch');
      if (row.event_type !== 'awarded') reasons.add('event_type_not_awarded');
      if (typeof row.recipient_name !== 'string' || JOINT_NAME.test(row.recipient_name)) reasons.add('joint_beneficiary');
    }
  }
  // 4. The preview succeeded and every record is new: nothing unchanged, nothing replaced.
  if (!plain(preview) || !DIGEST.test(preview.plan_digest || '')) reasons.add('preview_unknown');
  else {
    if (sum(preview.added) !== rows.length) reasons.add('not_all_records_new');
    if (sum(preview.unchanged) !== 0) reasons.add('existing_keys_in_packet');
  }
  return [...reasons];
}

/**
 * Every program and organization a record names must resolve to an existing
 * registry entity in the current baseline, and the pack's reference guards
 * must match the current registry file hashes.
 * @param {string} source
 * @param {any} pack
 * @param {{programs:Array<{id:string,org:string}>, orgs:Array<{id:string}>, source_blobs:Record<string,string>}} baseline
 * @returns {string[]}
 */
export function mappingReasons(source, pack, baseline) {
  const reasons = new Set();
  const config = Object.hasOwn(SOURCE_CATALOG, source) ? SOURCE_CATALOG[source] : null;
  const rows = packRecords(pack);
  if (!config || !rows || !plain(baseline) || !Array.isArray(baseline.programs) || !Array.isArray(baseline.orgs) || !plain(baseline.source_blobs)) return ['mapping_unknown'];
  const programs = new Map(baseline.programs.map(p => [p.id, p])), orgs = new Set(baseline.orgs.map(o => o.id));
  const program = programs.get(config.program);
  if (!program || program.org !== config.issuer || !orgs.has(config.issuer)) reasons.add('program_not_in_registry');
  for (const { row } of rows) {
    if (!programs.has(row.program)) reasons.add('program_not_in_registry');
    for (const org of orgFields(row)) if (!orgs.has(org)) reasons.add('org_not_in_registry');
  }
  const guards = plain(pack.reference_blobs) ? Object.entries(pack.reference_blobs) : [];
  if (!guards.length || guards.some(([path, hash]) => baseline.source_blobs[path] !== hash)) reasons.add('reference_guards_stale');
  return [...reasons];
}
