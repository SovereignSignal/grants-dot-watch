// A public snapshot must agree with the durable APPROVED control before it is served.
// This also closes the interval between a prepared filesystem write and its verdict.
import { createHash } from 'node:crypto';
const sha = text => createHash('sha256').update(text).digest('hex');
const hex = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
export class FundingReadError extends Error { constructor(code) { super(code); this.code=code; } }
const refuse = code => { throw new FundingReadError(code); };

export const COMMITTED_HEAD_SQL = `
  SELECT d.id::text AS id,
    (SELECT jsonb_agg(f->>'content_after') FROM jsonb_array_elements(d.files) f
      WHERE f->>'path'=$1) AS contents,
    EXISTS(SELECT 1 FROM desk_verdicts v WHERE v.proposal_id=d.proposal_id
      AND v.data->>'decision'='approved') AS approved
  FROM desk_applied_changes d
  WHERE d.state='ready' AND d.files @> $2::jsonb
  ORDER BY d.id DESC LIMIT 1`;
export function parseCommittedHead(result) {
  if(!result || !Array.isArray(result.rows) || result.rows.length>1)refuse('invalid_committed_head');
  if(!result.rows.length)return null;
  const row=result.rows[0];
  if(row.approved!==true || !Array.isArray(row.contents) || row.contents.length!==1 || typeof row.contents[0]!=='string' || Buffer.byteLength(row.contents[0])>4096)refuse('untrusted_committed_head');
  let value;try{value=JSON.parse(row.contents[0]);}catch{refuse('invalid_committed_head');}
  if(!value || Object.keys(value).sort().join(',')!=='dataset_sha256,previous_sha256,revision,version' || value.version!==1 || !hex(value.dataset_sha256) || !hex(value.revision) || (value.previous_sha256!==null&&!hex(value.previous_sha256)))refuse('invalid_committed_head');
  return {hash:sha(row.contents[0]),value};
}
export async function committedHead(query) {
  try {return parseCommittedHead(await query(COMMITTED_HEAD_SQL,['registry/funding-control.json','[{"path":"registry/funding-control.json"}]']));}
  catch(error){if(error instanceof FundingReadError)throw error;refuse('committed_head_unavailable');}
}
const same = (head,local) => (head?.hash??null)===(local?.control?.hash??null);
const ahead = (head,local) => Boolean(local?.control?.value && local.control.value.previous_sha256===(head?.hash??null) && !same(head,local));

/** Coalesces simultaneous reads, never caches a completed read across requests.
 * @template T
 * @param {{readHead:()=>Promise<unknown>,readLocal:()=>T,refresh:()=>Promise<unknown>,recoveryReady:()=>boolean}} deps
 */
export function createFundingReadCoordinator(deps) {
  let inFlight=null;const stats={reads:0,refreshes:0,refusals:0};
  async function run() {
    try {
      for(let attempt=0;attempt<3;attempt++){
        let head=await deps.readHead(),local=null;
        try{local=deps.readLocal();}catch{/* A corrupt/incomplete local copy must not be served. */}
        if(!deps.recoveryReady() || !local || !same(head,local)){
          // The verdict may have committed after the first SELECT. Look again
          // before treating locally prepared bytes as an older approved image.
          const newer=await deps.readHead();head=newer;
          if(!local || !same(head,local) || !deps.recoveryReady()){
            // Never replay backwards over a locally prepared, unapproved next
            // revision. It remains unavailable until approval or reconciliation.
            if(ahead(head,local))refuse('local_snapshot_not_approved');
            stats.refreshes++;await deps.refresh();
            if(!deps.recoveryReady())refuse('recovery_incomplete');
            local=deps.readLocal();
          }
        }
        const after=await deps.readHead();
        if(same(after,local) && deps.recoveryReady())return local;
        if(ahead(after,local))refuse('local_snapshot_not_approved');
        // A different owner committed while this read was being assembled.
        // Re-evaluate a bounded number of times, never mix snapshots.
      }
      refuse('funding_snapshot_busy');
    }catch(error){stats.refusals++;if(error instanceof FundingReadError)throw error;refuse('funding_snapshot_unavailable');}
  }
  return {
    read(){stats.reads++;if(!inFlight)inFlight=run().finally(()=>{inFlight=null;});return inFlight;},
    diagnostics(){return {...stats,active:inFlight!==null};},
  };
}
