import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { LEDGERS, canonical, validateFundingDataset } from './funding-model.mjs';

export const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
export const MAX_LEDGER_ROWS = 20000;
export const digest = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const blobHash = (content) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
export const emptyFundingDataset = () => Object.fromEntries(LEDGERS.map(k => [k, []]));

export function readFundingLedgers(root) {
  const actualRoot = realpathSync(root);
  const dataset = emptyFundingDataset();
  let bytes = 0, count = 0;
  for (const ledger of LEDGERS) {
    const dir = join(actualRoot, ledger);
    if (!existsSync(dir)) continue;
    if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) throw new Error('Unsafe ledger directory');
    for (const name of readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
      const path = join(dir, name), stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe ledger file');
      bytes += stat.size;
      if (bytes > MAX_LEDGER_BYTES) throw new Error('Funding ledger byte budget exceeded');
      const text = readFileSync(path, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > 65536 || ++count > MAX_LEDGER_ROWS) throw new Error('Funding ledger row budget exceeded');
        // A corrupt record must fail the whole v2 read, never masquerade as empty data.
        dataset[ledger].push(JSON.parse(line));
      }
    }
  }
  return dataset;
}

/** Baseline only includes public registry facts. It never opens a database. */
export function readBaseline(root, parseYaml) {
  const source_blobs = {};
  const readYaml = (sub) => {
    const dir = join(root, sub);
    if (!existsSync(dir)) throw new Error(`Missing legacy ${sub} directory`);
    if (lstatSync(dir).isSymbolicLink()) throw new Error('Unsafe legacy directory');
    return readdirSync(dir).filter(f => f.endsWith('.yaml')).sort().map(name => {
      const path = join(dir, name), stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) throw new Error('Unsafe legacy file');
      const content = readFileSync(path, 'utf8');
      source_blobs[`${sub}/${name}`] = blobHash(content);
      return parseYaml(content);
    });
  };
  const orgs = readYaml('orgs'), programs = readYaml('programs');
  const awards = [];
  const awardsDir = join(root, 'awards');
  if (existsSync(awardsDir)) {
    if (lstatSync(awardsDir).isSymbolicLink()) throw new Error('Unsafe awards directory');
    for (const name of readdirSync(awardsDir).filter(f => f.endsWith('.jsonl')).sort()) {
      const path = join(awardsDir, name), stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LEDGER_BYTES) throw new Error('Unsafe awards file');
      for (const line of readFileSync(path, 'utf8').split('\n').filter(l => l.trim())) awards.push(JSON.parse(line));
    }
  }
  return { orgs, programs, awards, source_blobs };
}

export function validateOrThrow(dataset, baseline, today) {
  const errors = validateFundingDataset(dataset, baseline, today);
  if (errors.length) throw new Error(`Invalid funding dataset (${errors.length}):\n${errors.slice(0, 30).join('\n')}`);
  return dataset;
}
