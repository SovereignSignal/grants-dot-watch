#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { readBaseline, readFundingLedgers, validateOrThrow } from '../src/lib/funding-store.mjs';
import { planFundingImport, writeFundingStage } from '../src/lib/funding-migration.mjs';
import { calendarDate } from '../src/lib/funding-api.mjs';
const scriptDir=dirname(fileURLToPath(import.meta.url));
try {
  const {values}=parseArgs({options:{root:{type:'string'},pack:{type:'string'},'write-stage':{type:'string'}},allowPositionals:false,strict:true});
  if(!values.pack) throw new Error('--pack is required. Omit --write-stage for a read-only preview.');
  const stat=lstatSync(values.pack);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>4*1024*1024) throw new Error('Candidate pack must be an ordinary file under 4 MiB');
  const root=resolve(values.root || resolve(scriptDir,'../registry'));
  const validateRoot=dir=>execFileSync(process.execPath,[resolve(scriptDir,'validate-registry.mjs')],{env:{...process.env,REGISTRY_ROOT:dir},stdio:'pipe',timeout:60000,maxBuffer:1048576});
  validateRoot(root);
  const baseline=readBaseline(root,YAML.parse), existing=readFundingLedgers(root), today=calendarDate();
  const plan=planFundingImport(baseline,existing,JSON.parse(readFileSync(values.pack,'utf8')),today);
  let staged_at=null;
  if(values['write-stage']) staged_at=writeFundingStage(root,values['write-stage'],plan,dir=>{
    validateRoot(dir);
    validateOrThrow(readFundingLedgers(dir),readBaseline(dir,YAML.parse),today);
  });
  console.log(JSON.stringify({...plan.report,mode:staged_at?'external_staging_copy':'dry_run',staged_at},null,2));
} catch(error) { console.error(error.message); if(error.stderr) console.error(String(error.stderr).slice(0,4000)); process.exitCode=1; }
