#!/usr/bin/env node
// One-shot logical backup verification. The source is read under one exported
// snapshot. Only the explicitly named NEW target can be written. No dump is published.
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const qi=n=>'"'+String(n).replaceAll('"','""')+'"';
const fail=code=>{throw Object.assign(new Error(code),{code});};
export const LIMITS=Object.freeze({tables:500,rows:500000,bytes:256*1024*1024,commandMs:120000});
export function connectionSpec(raw){
 let u;try{u=new URL(raw);}catch{fail('invalid_connection');}
 const host=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
 if(!['postgres:','postgresql:'].includes(u.protocol)||u.search||u.hash||!/^[a-zA-Z0-9_]+$/.test(u.pathname.slice(1))||!u.username||!(['localhost','127.0.0.1','::1'].includes(host)||/^[a-z0-9-]+\.railway\.internal$/.test(host)))fail('unsupported_connection');
 return {host,port:u.port||'5432',database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password)};
}
export function verifyRestoreTarget(source,target,expectedName){
 if(!/^gw_restore_[a-z0-9_]{8,48}$/.test(expectedName||'')||target.database!==expectedName||source.database===target.database)fail('unsafe_restore_target');return true;
}
export function commandEnv(spec,readOnly){
 return {PATH:process.env.PATH||'/usr/local/bin:/usr/bin:/bin',HOME:'/nonexistent',LANG:'C.UTF-8',PGHOST:spec.host,PGPORT:spec.port,PGDATABASE:spec.database,PGUSER:spec.user,PGPASSWORD:spec.password,PGCONNECT_TIMEOUT:'5',PGTZ:'UTC',PGOPTIONS:`-c statement_timeout=90000${readOnly?' -c default_transaction_read_only=on':''}`};
}
function command(bin,args,spec,readOnly){
 const r=spawnSync(bin,args,{env:commandEnv(spec,readOnly),encoding:'utf8',timeout:LIMITS.commandMs,maxBuffer:1024*1024,shell:false,stdio:['ignore','pipe','pipe']});
 if(r.error||r.status!==0)fail('postgres_command_failed');return r.stdout;
}
const versionOf=output=>{const match=/\(PostgreSQL\)\s+(\d+)(?:\.\d+)?/.exec(output);if(!match)fail('unknown_client_version');return Number(match[1]);};
const NS="n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'";
async function catalog(client){
 const q=async sql=>(await client.query(sql)).rows;
 const relations=await q(`SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,c.relrowsecurity AS row_security,c.relforcerowsecurity AS force_row_security FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${NS} AND c.relkind IN ('r','p','m','v','S','f') ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"`);
 if(relations.length>LIMITS.tables||relations.some(r=>r.kind==='f'))fail('unsupported_relation_scope');
 if(Number((await q('SELECT count(*)::text AS count FROM pg_largeobject_metadata'))[0].count)!==0)fail('large_objects_require_separate_verification');
 const columns=await q(`SELECT n.nspname AS schema,c.relname AS relation,a.attnum AS position,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,pg_get_expr(d.adbin,d.adrelid) AS default_expr FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE ${NS} AND c.relkind IN ('r','p','m','v') AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",a.attnum`);
 const constraints=await q(`SELECT n.nspname AS schema,c.relname AS relation,x.conname AS name,x.contype AS type,pg_get_constraintdef(x.oid,true) AS definition FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${NS} ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",x.conname COLLATE "C"`);
 const indexes=await q(`SELECT n.nspname AS schema,c.relname AS name,pg_get_indexdef(c.oid) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${NS} AND c.relkind='i' ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"`);
 const views=await q(`SELECT n.nspname AS schema,c.relname AS name,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${NS} AND c.relkind IN ('v','m') ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"`);
 const sequences=await q(`SELECT schemaname AS schema,sequencename AS name,data_type::text,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text FROM pg_sequences WHERE schemaname<>'information_schema' AND schemaname !~ '^pg_' ORDER BY schemaname COLLATE "C",sequencename COLLATE "C"`);
 const triggers=await q(`SELECT n.nspname AS schema,c.relname AS relation,t.tgname AS name,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${NS} AND NOT t.tgisinternal ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",t.tgname COLLATE "C"`);
 const functions=await q(`SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${NS} AND p.prokind IN ('f','p') ORDER BY n.nspname COLLATE "C",p.proname COLLATE "C",pg_get_function_identity_arguments(p.oid) COLLATE "C"`);
 const policies=await q(`SELECT schemaname AS schema,tablename AS relation,policyname AS name,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname !~ '^pg_' ORDER BY schemaname COLLATE "C",tablename COLLATE "C",policyname COLLATE "C"`);
 const extensions=await q('SELECT extname AS name,extversion AS version FROM pg_extension ORDER BY extname COLLATE "C"');
 return {relations,columns,constraints,indexes,views,sequences,triggers,functions,policies,extensions};
}
async function sequenceState(client,schema){const result=[];for(const s of schema.sequences){const value=(await client.query(`SELECT last_value::text,is_called FROM ${qi(s.schema)}.${qi(s.name)}`)).rows[0];result.push({schema:s.schema,name:s.name,...value});}return result;}
async function tableFingerprints(client,schema){
 const tables=[];let totalRows=0,totalBytes=0,index=0;
 for(const t of schema.relations.filter(t=>['r','p','m'].includes(t.kind))){
  const h=createHash('sha256');let rows=0,bytes=0;const name=`backup_rows_${index++}`;
  await client.query(`DECLARE ${name} NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS payload FROM ONLY ${qi(t.schema)}.${qi(t.name)} t ORDER BY row_to_json(t)::text COLLATE "C"`);
  try{for(;;){const batch=(await client.query(`FETCH FORWARD 500 FROM ${name}`)).rows;if(!batch.length)break;for(const {payload}of batch){const b=Buffer.from(payload,'utf8');rows++;bytes+=b.length;totalRows++;totalBytes+=b.length;if(totalRows>LIMITS.rows||totalBytes>LIMITS.bytes)fail('fingerprint_budget_exceeded');h.update(`${b.length}:`);h.update(b);h.update('\n');}}}finally{await client.query(`CLOSE ${name}`);}
  tables.push({schema:t.schema,name:t.name,rows,bytes,sha256:h.digest('hex')});
 }
 if(!tables.length||!totalRows)fail('empty_source_cannot_certify_restore');
 return {tables,total_rows:totalRows,total_bytes:totalBytes,sha256:hash(tables)};
}
async function readSession(client){
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='240s'; SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle='ISO, YMD'; SET LOCAL extra_float_digits=3");
}
export async function verifyDatabaseRestore({sourceUrl,targetUrl,expectedTarget,pgDump='pg_dump',pgRestore='pg_restore',Client:InjectedClient,afterRestore}){
 const source=connectionSpec(sourceUrl),target=connectionSpec(targetUrl);verifyRestoreTarget(source,target,expectedTarget);
 const Client=InjectedClient||(await import('pg')).Client;
 const config=s=>({...s,port:Number(s.port),connectionTimeoutMillis:5000,query_timeout:65000,application_name:'grants-watch-backup-verification'});
 let src,dst,admin,temp,stage='connect';const started=new Date().toISOString();
 const receipt={version:1,started_at:started,scope:'logical_database_without_owner_acl_or_cluster_globals',source_database:source.database,target_database:target.database,source_writes:false,target_created:false,passed:false};
 try{
  src=new Client(config(source));await src.connect();await readSession(src);
  const server=Number((await src.query('SHOW server_version_num')).rows[0].server_version_num);
  const dumpMajor=versionOf(command(pgDump,['--version'],source,true)),restoreMajor=versionOf(command(pgRestore,['--version'],target,false));
  if(dumpMajor<Math.floor(server/10000)||restoreMajor!==dumpMajor)fail('incompatible_client_version');
  receipt.server_major=Math.floor(server/10000);receipt.client_major=dumpMajor;
  const snapshot=(await src.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;if(!/^[0-9A-Fa-f-]+$/.test(snapshot))fail('invalid_exported_snapshot');
  stage='source_fingerprint';const schema=await catalog(src),sequences=await sequenceState(src,schema),data=await tableFingerprints(src,schema);
  receipt.schema_sha256=hash(schema);receipt.data=data;receipt.sequence_sha256=hash(sequences);
  stage='target_precondition';admin=new Client(config({...target,database:'postgres'}));await admin.connect();
  if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[target.database])).rows.length)fail('target_already_exists');
  await admin.query(`CREATE DATABASE ${qi(target.database)} TEMPLATE template0`);receipt.target_created=true;await admin.end();admin=null;
  stage='dump';temp=mkdtempSync(join(tmpdir(),'gw-backup-'));const archive=join(temp,'database.dump');
  command(pgDump,['--format=custom','--no-owner','--no-privileges',`--snapshot=${snapshot}`,'--lock-wait-timeout=5000',`--file=${archive}`],source,true);
  const size=statSync(archive).size;if(size<1||size>LIMITS.bytes)fail('archive_size_limit');receipt.archive={bytes:size,sha256:hash(readFileSync(archive))};
  if(hash(await sequenceState(src,schema))!==hash(sequences))fail('source_sequences_changed_during_dump');
  await src.query('COMMIT');await src.end();src=null;
  stage='restore';command(pgRestore,['--exit-on-error','--single-transaction','--no-owner','--no-privileges',`--dbname=${target.database}`,archive],target,false);
  dst=new Client(config(target));await dst.connect();if(afterRestore)await afterRestore(dst);
  await readSession(dst);stage='restored_fingerprint';
  const restoredSchema=await catalog(dst),restoredData=await tableFingerprints(dst,restoredSchema),restoredSequences=await sequenceState(dst,restoredSchema);
  receipt.restored={schema_sha256:hash(restoredSchema),data_sha256:restoredData.sha256,sequence_sha256:hash(restoredSequences),rows:restoredData.total_rows};
  if(receipt.schema_sha256!==receipt.restored.schema_sha256)fail('schema_mismatch');
  if(data.sha256!==restoredData.sha256)fail('row_fingerprint_mismatch');
  if(receipt.sequence_sha256!==receipt.restored.sequence_sha256)fail('sequence_mismatch');
  await dst.query('COMMIT');receipt.passed=true;receipt.completed_at=new Date().toISOString();return receipt;
 }catch(error){const safe=/^(?:[a-z_]{3,80}|[0-9A-Z]{5})$/.test(error?.code||'')?error.code:'verification_failed';throw Object.assign(new Error(`backup_verification_failed:${stage}:${safe}`),{receipt:{...receipt,stage,error:safe,completed_at:new Date().toISOString()}});}
 finally{await Promise.allSettled([src,dst,admin].filter(Boolean).map(c=>c.end()));if(temp)rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const expected=process.env.EXPECTED_RESTORE_DATABASE;
 if(process.env.ALLOW_NEW_RESTORE_DATABASE!==expected||!expected){console.error('Explicit new-target authorization is required');process.exitCode=1;}
 else{try{console.log('BACKUP_RESTORE_RECEIPT '+JSON.stringify(await verifyDatabaseRestore({sourceUrl:process.env.SOURCE_DATABASE_URL,targetUrl:process.env.TARGET_DATABASE_URL,expectedTarget:expected,pgDump:process.env.PG_DUMP_BIN||'pg_dump',pgRestore:process.env.PG_RESTORE_BIN||'pg_restore'})));}catch(error){console.error('BACKUP_RESTORE_RECEIPT '+JSON.stringify(error.receipt||{passed:false,error:'invalid_configuration'}));process.exitCode=1;}}
}
export const restoreDatabaseName=()=>`gw_restore_${randomUUID().replaceAll('-','')}`;
