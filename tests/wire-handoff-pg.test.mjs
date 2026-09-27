import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import { sql, rows, closePg, lockDatabase, skipWithoutPg } from './pg-helper.mjs';
import { fetchWireChanges } from '../src/lib/wire-handoff.ts';
const opts={skip:skipWithoutPg};
before(async()=>{if(skipWithoutPg)return;await lockDatabase();await sql(`CREATE TEMP TABLE scan_entries(id integer PRIMARY KEY,program_id integer,duplicate_of_id integer,name text,description text,enriched_summary text,source_url text,amount text,deadline text,deadline_parsed date,status text,wire text DEFAULT 'oss',classification text,tags text[],org_id integer,created_at timestamptz,updated_at timestamptz);CREATE TEMP TABLE org_profiles(id integer PRIMARY KEY,name text,website text,aliases text[],created_at timestamptz,updated_at timestamptz)`);});
after(closePg);
beforeEach(async()=>{if(skipWithoutPg)return;await sql('TRUNCATE scan_entries,org_profiles');});
test('PostgreSQL microsecond ties, older edits, joined edits and withdrawals are consumed once',opts,async()=>{
 await sql(`INSERT INTO org_profiles(id,name,created_at,updated_at) VALUES(1,'Example','2026-01-01','2026-09-25 01:00:00.000123Z');
 INSERT INTO scan_entries(id,status,org_id,created_at,updated_at) VALUES(1,'approved',1,'2026-01-01','2026-01-01'),(2,'duplicate',1,'2026-01-01','2026-01-01'),(3,'declined',null,'2026-01-01','2026-09-25 01:00:00.000124Z')`);
 await sql("INSERT INTO scan_entries(id,wire,created_at,updated_at) VALUES(0,'claw','2026-01-01','2026-09-25 01:00:00.000123Z')");
 const cursor={changed_at:'2026-09-25T01:00:00.000122Z',id:0};const query={query:sql};
 const first=await fetchWireChanges(query,cursor,1);assert.deepEqual(first.map(r=>r.id),[1]);assert.equal(first[0].changed_at,'2026-09-25T01:00:00.000123Z');
 const second=await fetchWireChanges(query,{changed_at:first[0].changed_at,id:1},1);assert.deepEqual(second.map(r=>r.id),[2]);assert.equal(second[0].status,'duplicate');
 const third=await fetchWireChanges(query,{changed_at:second[0].changed_at,id:2},1);assert.deepEqual(third.map(r=>r.id),[3]);assert.equal(third[0].changed_at,'2026-09-25T01:00:00.000124Z');
 assert.equal((await fetchWireChanges(query,{changed_at:third[0].changed_at,id:3},1)).length,0);
 assert.equal((await rows('SELECT count(*) FROM scan_entries'))[0].count,'4');
});
