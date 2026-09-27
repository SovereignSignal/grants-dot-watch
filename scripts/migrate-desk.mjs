#!/usr/bin/env node
import { Pool } from 'pg';
import { migrateDeskSchema, verifyDeskSchema } from '../src/lib/desk-schema.mjs';

if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--apply')) {
  throw new Error('Usage: node scripts/migrate-desk.mjs [--apply]');
}
if (process.argv[2] !== '--apply') {
  console.log(JSON.stringify({mode: 'dry-run', tables: ['desk_proposals','desk_verdicts','ingest_state','desk_applied_changes'], changes: 'Create missing Desk tables, lifecycle columns and ready-row index. Preserve existing records.', requires: 'Dedicated owner connection in DATABASE_URL; runtime never executes these migrations.'}));
} else {
  if (!process.env.DATABASE_URL) throw new Error('Owner DATABASE_URL is required');
  const pool = new Pool({connectionString: process.env.DATABASE_URL});
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(8892014)');
    await migrateDeskSchema(db);
    await verifyDeskSchema(db);
    await db.query('COMMIT');
    console.log(JSON.stringify({status: 'Desk schema verified', registryReloaded: false}));
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
}
