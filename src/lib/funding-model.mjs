// Additive evidence contract. Preserve the previous validators verbatim in core.
import { FUNDING_SCHEMAS as CORE, LEDGERS, schemaErrors, validateFundingDataset as validateCore } from './funding-model-core.mjs';
import { PROVENANCE_SCHEMA, provenanceErrors } from './funding-provenance.mjs';
export * from './funding-model-core.mjs';
const nullable = schema => ({anyOf:[schema,{type:'null'}]});
const additions = {
  'program-terms':{},
  'funding-events':{
    purpose:nullable({type:'string',minLength:1,maxLength:2000}),
    recipient_url:nullable({type:'string',minLength:1,maxLength:2048,format:'public-url'}),
  },
  'process-metrics':{
    published_percent:nullable({type:'string',minLength:2,maxLength:8,pattern:'^(0|[1-9][0-9]?|100)(\\.[0-9])?%$'}),
  },
};
export const FUNDING_SCHEMAS=Object.fromEntries(LEDGERS.map(ledger=>[ledger,{
  ...CORE[ledger],properties:{...CORE[ledger].properties,...additions[ledger],provenance:nullable(PROVENANCE_SCHEMA)},
}]));
export const TERMS_SCHEMA=FUNDING_SCHEMAS['program-terms'];
export const EVENT_SCHEMA=FUNDING_SCHEMAS['funding-events'];
export const METRIC_SCHEMA=FUNDING_SCHEMAS['process-metrics'];
export function validateFundingDataset(dataset,baseline,today) {
  const stripped={...dataset};
  const errors=[];
  for(const ledger of LEDGERS){
    if(!Array.isArray(dataset[ledger])) continue;
    stripped[ledger]=dataset[ledger].map(row=>{
      const shape=schemaErrors(FUNDING_SCHEMAS[ledger],row,ledger);
      errors.push(...shape);
      if(!row || typeof row!=='object' || Array.isArray(row)) return row;
      if(!shape.length){
        errors.push(...provenanceErrors(row,today).map(e=>`${ledger}: ${e}`));
        if(ledger==='process-metrics'&&row.published_percent!=null){
          const places=row.published_percent.includes('.')?1:0;
          if(!(row.eligible_applications>0) || row.offers==null ||
            (100*row.offers/row.eligible_applications).toFixed(places)!==Number(row.published_percent.slice(0,-1)).toFixed(places)) errors.push(`${ledger}: published_rate_mismatch`);
        }
      }
      return Object.fromEntries(Object.entries(row).filter(([key])=>key!=='provenance'&&!Object.hasOwn(additions[ledger],key)));
    });
  }
  return [...errors,...validateCore(stripped,baseline,today)];
}
