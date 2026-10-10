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
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const LEDGER_PATHS = new Set(['program-terms', 'funding-events', 'process-metrics', 'funding-control.json']);

export function legacyRegistryCopy(source = resolve('registry')) {
  const temp = mkdtempSync(join(tmpdir(), 'legacy-registry-'));
  const root = join(temp, 'registry');
  const top = resolve(source);
  cpSync(top, root, {
    recursive: true,
    filter: (path) => !(dirname(resolve(path)) === top && LEDGER_PATHS.has(basename(path))),
  });
  return { root, cleanup: () => rmSync(temp, { recursive: true, force: true }) };
}
