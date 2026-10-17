-- 002_operational.sql
-- Operational tables: real Postgres state that has no file equivalent.
-- Not rebuilt from registry/ files (unlike 001) — org_sources is seeded from
-- registry urls on first load but then accumulates its own history
-- (last_checked, http_status) that the loader must not clobber on rerun.
-- Desk tables (desk_proposals, desk_verdicts, ingest_state) already exist
-- via src/lib/desk-store.ts — do not touch them here.

-- ---- org_sources: every URL known for an org, with liveness tracking ----
CREATE TABLE IF NOT EXISTS org_sources (
  id            bigserial PRIMARY KEY,
  org_id        text NOT NULL,                     -- references registry_orgs.id
  url           text NOT NULL,
  kind          text NOT NULL,                      -- website | apply | program | social | source
  last_checked  timestamptz,
  http_status   int,
  dead          boolean NOT NULL DEFAULT false,
  notes         text,
  UNIQUE (org_id, url)
);

CREATE INDEX IF NOT EXISTS idx_org_sources_org   ON org_sources (org_id);
CREATE INDEX IF NOT EXISTS idx_org_sources_dead ON org_sources (dead);

-- ---- notion_map: org <-> Notion "Orgs" row, for the registry->Notion mirror ----
CREATE TABLE IF NOT EXISTS notion_map (
  org_id         text PRIMARY KEY,                  -- references registry_orgs.id
  notion_page_id text NOT NULL,
  last_synced    timestamptz
);

-- ---- enrichment_runs: a log of loader/enrichment passes ----
CREATE TABLE IF NOT EXISTS enrichment_runs (
  id                bigserial PRIMARY KEY,
  started           timestamptz NOT NULL,
  finished          timestamptz,
  orgs_checked      int NOT NULL DEFAULT 0,
  facts_applied     int NOT NULL DEFAULT 0,
  proposals_created int NOT NULL DEFAULT 0,
  notes             jsonb
);
