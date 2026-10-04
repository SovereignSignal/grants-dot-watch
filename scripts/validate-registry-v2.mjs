#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { FUNDING_SCHEMAS, LEDGERS } from '../src/lib/funding-model.mjs';
import { readBaseline, readFundingLedgers, validateOrThrow } from '../src/lib/funding-store.mjs';
import { calendarDate } from '../src/lib/funding-api.mjs';
try {
  const {values} = parseArgs({options:{root:{type:'string'},'print-schema':{type:'boolean'}},allowPositionals:false,strict:true});
  if (values['print-schema']) console.log(JSON.stringify({schema_version:2,ledgers:FUNDING_SCHEMAS},null,2));
  else {
    const root=values.root || process.env.REGISTRY_ROOT || resolve(dirname(fileURLToPath(import.meta.url)),'../registry');
    const baseline=readBaseline(root,YAML.parse), dataset=readFundingLedgers(root);
    validateOrThrow(dataset,baseline,calendarDate());
    console.log(JSON.stringify({status:'valid',counts:Object.fromEntries(LEDGERS.map(k=>[k,dataset[k].length]))}));
  }
} catch(error) { console.error(error.message); process.exitCode=1; }
