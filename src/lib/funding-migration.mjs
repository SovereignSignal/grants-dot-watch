import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { FUNDING_SCHEMAS, LEDGERS, canonical, schemaErrors, validateFundingDataset } from './funding-model.mjs';
import { blobHash, digest, readFundingLedgers } from './funding-store.mjs';

const contained = (parent, child) => { const rel = relative(parent, child); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
const keysMatch = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k));

/** Returns a deterministic candidate snapshot. Never mutates the supplied baseline. */
export function planFundingImport(baseline, existing, pack, today) {
  if (!keysMatch(pack, ['schema_version','id','reference_blobs','records']) || pack.schema_version !== 2 || !/^[a-z0-9][a-z0-9-]*$/.test(pack.id || '')) throw new Error('Invalid migration envelope');
  if (!keysMatch(pack.records, LEDGERS) || !keysMatch(pack.reference_blobs, Object.keys(baseline.source_blobs || {}))) throw new Error('Invalid migration references');
  for (const [path, hash] of Object.entries(pack.reference_blobs)) {
    if (!/^(orgs|programs)\/[a-z0-9][a-z0-9-]*\.yaml$/.test(path) || !/^[a-f0-9]{40}$/.test(hash) || baseline.source_blobs[path] !== hash) throw new Error('Baseline has changed; re-review migration references');
  }
  const next = structuredClone(existing);
  const added = {}, unchanged = {};
  for (const ledger of LEDGERS) {
    added[ledger] = 0; unchanged[ledger] = 0;
    if (!Array.isArray(pack.records[ledger])) throw new Error('Each ledger must be supplied as an array');
    const current = new Map(next[ledger].map(row => [row.key, row]));
    const submitted = new Set();
    for (const row of pack.records[ledger]) {
      if (schemaErrors(FUNDING_SCHEMAS[ledger], row).length) throw new Error('Invalid migration record');
      if (submitted.has(row.key)) throw new Error('Duplicate key within migration pack');
      submitted.add(row.key);
      const references = [row.program && `programs/${row.program}.yaml`, ...[row.funder, row.operator_org, row.disburser_org, ...(row.capital_source_orgs || [])].filter(Boolean).map(org => `orgs/${org}.yaml`)].filter(Boolean);
      if (references.some(path => !Object.hasOwn(pack.reference_blobs, path))) throw new Error('Every referenced program and organization needs a baseline blob guard');
      const previous = current.get(row.key);
      if (previous) {
        if (canonical(previous) !== canonical(row)) throw new Error('Existing key has different contents; append a reviewed superseding record');
        unchanged[ledger]++;
      } else {
        current.set(row.key, structuredClone(row));
        next[ledger].push(structuredClone(row)); added[ledger]++;
      }
    }
    next[ledger].sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }
  const errors = validateFundingDataset(next, baseline, today);
  if (errors.length) throw new Error(`Migration validation failed:\n${errors.slice(0, 30).join('\n')}`);
  return {
    dataset: next, reference_blobs: structuredClone(pack.reference_blobs),
    report: {
      schema_version: 2, migration_id: pack.id, status: 'staged_candidate', review_required: true,
      checked_on: today, source_snapshot: digest(baseline.source_blobs),
      input_snapshot: digest(existing), output_snapshot: digest(next), plan_digest: digest(pack),
      added, unchanged, legacy_files_changed: 0,
      payment_events_added: pack.records['funding-events'].filter(row => row.event_type === 'paid' && !existing['funding-events'].some(old => old.key === row.key)).length,
    },
  };
}
function assertNoSymlinks(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name), stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Registry staging does not follow symlinks');
    if (stat.isDirectory()) assertNoSymlinks(path);
    else if (!stat.isFile()) throw new Error('Registry staging requires ordinary files');
  }
}
function treeFingerprint(dir) {
  const hashes = {};
  const walk = (sub) => {
    for (const name of readdirSync(sub).sort()) {
      const path = join(sub, name), stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else hashes[relative(dir, path)] = digest(readFileSync(path));
    }
  };
  walk(dir); return digest(hashes);
}
/** Publish one NEW staging directory atomically. There is intentionally no --apply mode. */
export function writeFundingStage(root, output, plan, validateStage = () => {}) {
  const source = realpathSync(root), destination = resolve(output);
  const parent = realpathSync(dirname(destination));
  if (destination !== join(parent, basename(destination)) || contained(source,destination) || contained(destination,source)) throw new Error('Staging destination must be outside the source registry and use a real parent');
  if (existsSync(destination)) throw new Error('Refusing to overwrite an existing staging directory');
  assertNoSymlinks(source);
  for (const [path, hash] of Object.entries(plan.reference_blobs || {})) {
    if (!/^(orgs|programs)\/[a-z0-9][a-z0-9-]*\.yaml$/.test(path) || blobHash(readFileSync(join(source,path))) !== hash) throw new Error('Baseline changed after planning');
  }
  if (digest(readFundingLedgers(source)) !== plan.report.input_snapshot) throw new Error('Funding ledgers changed after planning');
  const before = treeFingerprint(source);
  const temp = mkdtempSync(join(parent, '.funding-stage-'));
  try {
    const stagedRoot = join(temp, 'registry');
    cpSync(source, stagedRoot, { recursive: true, errorOnExist: true });
    for (const ledger of LEDGERS) {
      const dir = join(stagedRoot, ledger); mkdirSync(dir, { recursive: true });
      // Existing JSONL bytes are preserved. Only new keys get a separate migration shard.
      const present = new Set();
      for (const name of readdirSync(dir).filter(f => f.endsWith('.jsonl'))) for (const line of readFileSync(join(dir,name),'utf8').split('\n').filter(l=>l.trim())) present.add(JSON.parse(line).key);
      const added = plan.dataset[ledger].filter(row => !present.has(row.key));
      if (added.length) writeFileSync(join(dir, `${plan.report.migration_id}.jsonl`), `${added.map(canonical).join('\n')}\n`, {flag:'wx'});
    }
    validateStage(stagedRoot);
    if (treeFingerprint(source) !== before) throw new Error('Source changed during staging');
    writeFileSync(join(temp, 'migration-report.json'), `${JSON.stringify(plan.report,null,2)}\n`, {flag:'wx'});
    if (existsSync(destination)) throw new Error('Staging destination appeared during validation');
    renameSync(temp, destination);
  } catch (error) { rmSync(temp,{recursive:true,force:true}); throw error; }
  return destination;
}
