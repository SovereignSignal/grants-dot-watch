// Schema creation is an explicit operator action in production.
// Development and isolated tests may provision the same contract.
export async function migrateDeskSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS desk_proposals (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      lane text NOT NULL,
      state text NOT NULL,
      created_at timestamptz NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS desk_verdicts (
      proposal_id text NOT NULL,
      data jsonb NOT NULL,
      at timestamptz NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ingest_state (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Durable applied-changes ledger — same DDL as db/migrations/003_desk_ledger.sql
  // (kept in sync). Production runs this through migrate-desk.mjs.
  await db.query(`
    CREATE TABLE IF NOT EXISTS desk_applied_changes (
      id serial PRIMARY KEY,
      proposal_id text,
      files jsonb NOT NULL,
      message text,
      state text NOT NULL DEFAULT 'ready',
      sha text,
      synced_at timestamptz,
      last_error text,
      last_attempt_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Existing installations may predate the outbox lifecycle columns. These
  // additive migrations are safe to run repeatedly by the migration owner.
  await db.query(`ALTER TABLE desk_applied_changes ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'ready'`);
  await db.query(`ALTER TABLE desk_applied_changes ADD COLUMN IF NOT EXISTS last_error text`);
  await db.query(`ALTER TABLE desk_applied_changes ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz`);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_desk_applied_changes_ready
      ON desk_applied_changes (id) WHERE synced_at IS NULL AND state = 'ready'
  `);
}

export async function verifyDeskSchema(db) {
  // LIMIT 0 checks column compatibility and SELECT access without DDL or data writes.
  await db.query(`
    SELECT id,data,lane,state,created_at FROM desk_proposals LIMIT 0;
    SELECT proposal_id,data,at FROM desk_verdicts LIMIT 0;
    SELECT key,value,updated_at FROM ingest_state LIMIT 0;
    SELECT id,proposal_id,files,message,state,sha,synced_at,last_error,last_attempt_at,created_at
      FROM desk_applied_changes LIMIT 0;
  `);
}
