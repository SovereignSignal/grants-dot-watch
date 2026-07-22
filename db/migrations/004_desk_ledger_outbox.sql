-- 004_desk_ledger_outbox.sql
-- Upgrade an existing Desk ledger to a transactional outbox. Only ready rows
-- are replayable. A prepared row becomes ready in the same transaction as its
-- approved verdict; failed writes are abandoned.

ALTER TABLE desk_applied_changes
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'ready';

ALTER TABLE desk_applied_changes
  ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE desk_applied_changes
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_desk_applied_changes_ready
  ON desk_applied_changes (id) WHERE synced_at IS NULL AND state = 'ready';
