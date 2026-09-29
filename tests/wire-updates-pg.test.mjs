import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql, closePg, skipWithoutPg } from './pg-helper.mjs';
import { readUpdatePage } from '../src/lib/wire-updates.ts';
const opts = { skip: skipWithoutPg };
const pool = { connect: async () => ({ query: sql, release() {} }) };

before(async () => {
  if (skipWithoutPg) return;
  await sql(`CREATE TEMP TABLE scan_entries(id integer PRIMARY KEY, name text DEFAULT 'Example grant',
    description text DEFAULT 'Public application information', source_url text DEFAULT 'https://example.org/call',
    wire text DEFAULT 'oss', amount text, deadline text, deadline_parsed date, classification text DEFAULT 'GRANT',
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), status text DEFAULT 'approved',
    distributable boolean DEFAULT true, duplicate_of_id integer, metadata jsonb DEFAULT '{}');
    INSERT INTO scan_entries(id) VALUES(1),(3),(5),(7),(9),(11),(13),(15);
    UPDATE scan_entries SET status='queued' WHERE id=3;
    UPDATE scan_entries SET distributable=false WHERE id=5;
    UPDATE scan_entries SET distributable=null WHERE id=7;
    UPDATE scan_entries SET duplicate_of_id=1 WHERE id=9;
    UPDATE scan_entries SET metadata='{"operator_route":"relationship_signal","secret":"CANARY"}' WHERE id=11;
    UPDATE scan_entries SET wire='internal' WHERE id=13;
    UPDATE scan_entries SET description='' WHERE id=15;`);
});
after(closePg);

test('real SQL excludes quiet, unreviewed, private, duplicate and incomplete records', opts, async () => {
  const page = await readUpdatePage({ after: 0, limit: 100 }, pool);
  assert.deepEqual(page.rows.map(r => r.id), [1]);
  assert.equal(page.next, null); assert.equal(page.through, 15);
  assert.equal('metadata' in page.rows[0], false);
});

test('full reconciliation finds an old newly approved record and reflects withdrawals', opts, async () => {
  await sql("UPDATE scan_entries SET status='approved' WHERE id=3");
  const first = await readUpdatePage({ after: 0, limit: 1 }, pool);
  assert.deepEqual(first.rows.map(r => r.id), [1]); assert.equal(first.next, 1);
  const second = await readUpdatePage({ after: first.next, through: first.through, limit: 1 }, pool);
  assert.deepEqual(second.rows.map(r => r.id), [3]); assert.equal(second.next, null);
  await sql("UPDATE scan_entries SET status='declined' WHERE id=1");
  assert.deepEqual((await readUpdatePage({ after: 0, limit: 100 }, pool)).rows.map(r => r.id), [3]);
  assert.equal((await readUpdatePage({ after: 0, through: 1, limit: 1 }, pool)).rows.length, 0);
});
