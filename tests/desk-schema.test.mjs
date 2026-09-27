import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateDeskSchema, verifyDeskSchema } from '../src/lib/desk-schema.mjs';
import { lockDatabase, sql, closePg, skipWithoutPg } from './pg-helper.mjs';

test('production schema verification executes SELECT only',async()=>{
 const queries=[];await verifyDeskSchema({query:async q=>queries.push(q)});
 assert.doesNotMatch(queries.join('\n'),/\b(CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/);
 assert.match(queries.join('\n'),/last_attempt_at/);
});
test('restricted runtime can use Desk schema but cannot migrate or delete', {skip:skipWithoutPg}, async()=>{
 await lockDatabase();
 try {
  await migrateDeskSchema({query:sql});
  await sql('BEGIN');
  await sql('CREATE ROLE desk_test_runtime_stage15 NOLOGIN');
  await sql('GRANT USAGE ON SCHEMA public TO desk_test_runtime_stage15');
  await sql('GRANT SELECT, INSERT, UPDATE ON desk_proposals,desk_verdicts,ingest_state,desk_applied_changes TO desk_test_runtime_stage15');
  await sql('GRANT USAGE ON SEQUENCE desk_applied_changes_id_seq TO desk_test_runtime_stage15');
  await sql('SET LOCAL ROLE desk_test_runtime_stage15');
  await verifyDeskSchema({query:sql});
  await sql("INSERT INTO ingest_state(key,value) VALUES ('schema-test','{}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");
  await sql("INSERT INTO desk_applied_changes(files) VALUES ('[]')");
  for (const query of ['ALTER TABLE ingest_state ADD COLUMN forbidden text','DELETE FROM ingest_state']) {
   await sql('SAVEPOINT denied');await assert.rejects(sql(query),/permission denied|must be owner/);await sql('ROLLBACK TO SAVEPOINT denied');
  }
 } finally {await sql('ROLLBACK');await closePg();}
});
