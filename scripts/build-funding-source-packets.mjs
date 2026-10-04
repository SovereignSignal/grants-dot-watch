#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {dirname,resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,lstatSync,readFileSync,realpathSync,mkdtempSync,writeFileSync,mkdirSync,renameSync,rmSync} from 'node:fs';
import YAML from 'yaml';
import {calendarDate} from '../src/lib/funding-api.mjs';
import {readBaseline} from '../src/lib/funding-store.mjs';
import {readControlledFunding} from '../src/lib/funding-desk-core.mjs';
import {compileFundingSourcePackets} from '../src/lib/funding-source-packets.mjs';
const contained=(a,b)=>{const p=relative(a,b);return p===''||(!p.startsWith(`..${sep}`)&&p!=='..'&&!isAbsolute(p));};
try {
 const {values}=parseArgs({options:{input:{type:'string'},root:{type:'string'},out:{type:'string'}},strict:true,allowPositionals:false});
 if(!values.input)throw new Error('--input is required; it must be a reviewed source snapshot bundle');
 const info=lstatSync(values.input);if(info.isSymbolicLink()||!info.isFile()||info.size>4*1024*1024)throw new Error('Input must be an ordinary file under 4 MiB');
 const input=JSON.parse(readFileSync(values.input,'utf8'));
 if(!input||Object.keys(input).sort().join(',')!=='snapshots,version'||input.version!==1)throw new Error('Invalid source bundle');
 const root=realpathSync(values.root||resolve(dirname(fileURLToPath(import.meta.url)),'../registry'));
 const result=compileFundingSourcePackets(input.snapshots,readBaseline(root,YAML.parse),readControlledFunding(root).dataset,calendarDate());
 if(values.out) {
  const dest=resolve(values.out),parent=realpathSync(dirname(dest));
  if(dest!==join(parent,dest.split(sep).at(-1))||contained(root,dest)||contained(dest,root)||existsSync(dest))throw new Error('Output must be a new external directory with a real parent');
  const temp=mkdtempSync(join(parent,'.funding-sources-'));
  try {
   mkdirSync(join(temp,'packets'));
   for(const pack of result.packets)writeFileSync(join(temp,'packets',`${pack.id}.json`),JSON.stringify(pack,null,2)+'\n',{flag:'wx'});
   for(const key of ['report','claims','held','unchanged','source_receipts','source_failures','coverage_gaps'])writeFileSync(join(temp,`${key}.json`),JSON.stringify(result[key],null,2)+'\n',{flag:'wx'});
   if(existsSync(dest))throw new Error('Output appeared during preparation');renameSync(temp,dest);
  }catch(error){rmSync(temp,{recursive:true,force:true});throw error;}
 }
 console.log(JSON.stringify(result.report,null,2));
 if(result.source_failures.length)process.exitCode=2;
} catch(error){console.error(error.message);process.exitCode=1;}
