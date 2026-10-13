// Reusable, isolated review fixture. It has no production-application mode.
import { cpSync, mkdtempSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function createProgramRoundPreview() {
  const repo = resolve(import.meta.dirname, '..');
  const dir = mkdtempSync(join(tmpdir(), 'gw-round-preview-'));
  try {
    cpSync(join(repo, 'registry'), join(dir, 'registry'), { recursive: true });
    mkdirSync(join(dir,'scripts'));
    cpSync(join(repo,'scripts/validate-registry.mjs'),join(dir,'scripts/validate-registry.mjs'));
    symlinkSync(join(repo,'node_modules'),join(dir,'node_modules'),'dir');
    const output = execFileSync(process.execPath, ['--experimental-strip-types', '--experimental-loader', join(repo,'tests/ts-loader.mjs'), join(repo,'tests/fixtures/program-round-preview.mjs')], {
      cwd: dir, encoding: 'utf8', timeout: 60000, maxBuffer: 2*1024*1024,
      env: {...process.env, DATABASE_URL:'', WIRE_DATABASE_URL:'', INGEST_ENABLED:'0', GRANTS_WATCH_NO_GIT:'', GRANTS_WATCH_FUNDING_DESK:'1'},
    });
    return {dir, report:JSON.parse(output), cleanup:()=>rmSync(dir,{recursive:true,force:true})};
  } catch (error) { rmSync(dir,{recursive:true,force:true}); throw error; }
}
