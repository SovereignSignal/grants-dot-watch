#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {dirname,basename,resolve,relative,isAbsolute,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,mkdtempSync,realpathSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {captureMicrosoftFund,NATIVE_SOURCE_LIMITS} from '../src/lib/funding-source-native.mjs';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const outside=(parent,path)=>{const rel=relative(parent,path);return rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel);};
try{
  const {values}=parseArgs({options:{source:{type:'string'},fund:{type:'string'},revision:{type:'string'},fetch:{type:'boolean'},out:{type:'string'}},strict:true,allowPositionals:false});
  if(values.source!=='microsoft-foss')throw new Error('Only --source microsoft-foss is supported');
  const fund=Number(values.fund||'36'),revision=values.revision||null;
  if(!Number.isSafeInteger(fund)||fund<1||fund>100000||(revision!==null&&!/^[a-f0-9]{40}$/.test(revision)))throw new Error('Invalid fund or revision');
  if(!values.fetch){if(values.out)throw new Error('--out requires explicit --fetch');console.log(JSON.stringify({mode:'dry_run',source:values.source,fund,revision,limits:NATIVE_SOURCE_LIMITS,network_requests:0,canonical_write:false}));}
  else{
    if(!values.out)throw new Error('--fetch requires a new external --out directory');
    const dest=resolve(values.out),parent=realpathSync(dirname(dest));
    if(!outside(project,dest)||!outside(dest,project)||dest!==join(parent,basename(dest))||existsSync(dest))throw new Error('Output must be a new external directory with a real parent');
    const result=await captureMicrosoftFund({fund,revision});
    const temp=mkdtempSync(join(parent,'.funding-capture-'));
    try{
      writeFileSync(join(temp,'bundle.json'),JSON.stringify(result.bundle,null,2)+'\n',{flag:'wx'});
      writeFileSync(join(temp,'capture-receipt.json'),JSON.stringify(result.receipt,null,2)+'\n',{flag:'wx'});
      if(existsSync(dest))throw new Error('Output appeared during capture');renameSync(temp,dest);
    }catch(error){rmSync(temp,{recursive:true,force:true});throw error;}
    console.log(JSON.stringify({...result.receipt,mode:'captured_candidate',output:dest}));
  }
}catch(error){console.error(error.message);process.exitCode=1;}
