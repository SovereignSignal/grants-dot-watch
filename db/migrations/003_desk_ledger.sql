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
  files       jsonb NOT NULL,             -- [{path, content_after}] — full file contents post-write
  message     text,                       -- the commit message that would have been used
  sha         text,                       -- set by sync-desk-commits.mjs once committed locally
  synced_at   timestamptz,                -- set when synced (even if content already matched)
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_desk_applied_changes_unsynced
  ON desk_applied_changes (id) WHERE synced_at IS NULL;
