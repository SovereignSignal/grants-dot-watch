// A disposable copy of registry/ as it was before any funding ledger reached
// Git: programs, orgs, systems and awards, but no program-terms, funding-events
// or process-metrics shards and no funding-control.json.
//
// The research pilots under research/v2/ were written against that empty
// ledger, and their tests prove the import path from it: records are added,
// nothing is fabricated, a repeat is a no-op. Since 2026-10-10 the real
// registry carries those very records (the Desk ledger is synced to Git), so
// staging them against registry/ reports zero additions. These tests are
// about the path, not the current contents, so they run on this copy.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const LEDGER_PATHS = new Set(['program-terms', 'funding-events', 'process-metrics', 'funding-control.json']);

/** Copy registry/ into `dest` without its ledger shards and control file. */
export function copyLegacyRegistry(dest, source = resolve('registry')) {
  const top = resolve(source);
  cpSync(top, dest, {
    recursive: true,
    filter: (path) => !(dirname(resolve(path)) === top && LEDGER_PATHS.has(basename(path))),
  });
  return dest;
}

/** Put each file a pilot pack references back at the exact blob it was written against.
 *  Desk syncs keep editing those orgs and programs; the pilots test the import path, so
 *  they read the pinned bytes from Git history instead of whatever registry/ holds now. */
export function restoreReferenceBlobs(root, pack) {
  for (const [path, hash] of Object.entries(pack.reference_blobs || {})) {
    writeFileSync(join(root, path), execFileSync('git', ['cat-file', 'blob', hash]));
  }
}

export function legacyRegistryCopy(source = resolve('registry')) {
  const temp = mkdtempSync(join(tmpdir(), 'legacy-registry-'));
  const root = copyLegacyRegistry(join(temp, 'registry'), source);
  return { root, cleanup: () => rmSync(temp, { recursive: true, force: true }) };
}
