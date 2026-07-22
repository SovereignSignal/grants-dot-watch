-- 003_desk_ledger.sql
-- Durable applied-changes ledger for The Desk. On Railway the filesystem is
-- ephemeral and GRANTS_WATCH_NO_GIT=1 disables in-process git, so an approved
-- proposal's file writes would otherwise vanish on redeploy with no record.
-- Whenever committer.ts applies changes but cannot produce a commit sha (the
-- NO_GIT guard or a git failure), it persists the full change set here —
-- including each file's complete post-write content — and
-- scripts/sync-desk-commits.mjs later replays unsynced rows into the real
-- repo as one commit per row, stamping sha + synced_at.
-- The table is also created at runtime by src/lib/desk-store.ts
-- (CREATE TABLE IF NOT EXISTS, same DDL) so the app never depends on the
-- loader having run; keep the two in sync.

CREATE TABLE IF NOT EXISTS desk_applied_changes (
  id          serial PRIMARY KEY,
  proposal_id text,                       -- proposal id, or comma-joined ids for a bulk approve
  files       jsonb NOT NULL,             -- [{path, content_before_hash, content_after}] compare-and-set snapshots
  message     text,                       -- the commit message that would have been used
  state       text NOT NULL DEFAULT 'ready', -- prepared becomes ready atomically with the approved verdict
  sha         text,                       -- set by sync-desk-commits.mjs once committed locally
  synced_at   timestamptz,                -- set when synced (even if content already matched)
  last_error  text,                       -- most recent replay conflict/error, cleared on success
  last_attempt_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_desk_applied_changes_ready
  ON desk_applied_changes (id) WHERE synced_at IS NULL AND state = 'ready';
