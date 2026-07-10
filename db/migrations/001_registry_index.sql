-- 001_registry_index.sql
-- INDEX tables: faithful relational mirrors of registry/ YAML+JSONL files.
-- Files in registry/ are canonical (see docs/DESIGN.md). These tables are a
-- disposable query index — DROP-and-rebuild safe, rebuilt in full by
-- scripts/load-registry-pg.mjs on every run. Never hand-edit rows here;
-- edit the registry/ file and re-run the loader.

-- ---- systems (registry/systems/<id>.yaml) ----
CREATE TABLE IF NOT EXISTS registry_systems (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  kind              text NOT NULL,               -- protocol-ecosystem | funding-domain
  part_of           text[] NOT NULL DEFAULT '{}',
  wires             text[] NOT NULL DEFAULT '{}',
  summary           text,
  funding_channels  text[] NOT NULL DEFAULT '{}',
  sources           text[] NOT NULL DEFAULT '{}',
  data              jsonb NOT NULL,               -- full parsed doc, for fields not broken out
  content_hash      text NOT NULL,
  loaded_at         timestamptz NOT NULL DEFAULT now()
);

-- ---- orgs (registry/orgs/<id>.yaml) ----
CREATE TABLE IF NOT EXISTS registry_orgs (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  aka           text[] NOT NULL DEFAULT '{}',
  systems       text[] NOT NULL DEFAULT '{}',
  wires         text[] NOT NULL DEFAULT '{}',
  roles         text[] NOT NULL DEFAULT '{}',     -- funder | grantee | ecosystem
  org_type      text,
  website       text,
  socials       jsonb NOT NULL DEFAULT '{}',
  status        text,                             -- active | winding-down | dormant | unknown
  profile       text,
  funding       jsonb,                            -- { focus, typical_size, cadence, apply_url }
  sources       text[] NOT NULL DEFAULT '{}',
  data          jsonb NOT NULL,
  content_hash  text NOT NULL,
  loaded_at     timestamptz NOT NULL DEFAULT now()
);

-- ---- programs (registry/programs/<id>.yaml) ----
CREATE TABLE IF NOT EXISTS registry_programs (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  org           text NOT NULL,                    -- references registry_orgs.id (not FK-enforced: index is rebuilt from files, load order is not guaranteed)
  parent        text,
  systems       text[] NOT NULL DEFAULT '{}',
  wires         text[] NOT NULL DEFAULT '{}',
  status        text,
  mechanism     text,
  apply_url     text,
  summary       text,
  rounds        jsonb NOT NULL DEFAULT '[]',       -- [{name,status,opens,closes,size,source}]
  sources       text[] NOT NULL DEFAULT '{}',
  data          jsonb NOT NULL,
  content_hash  text NOT NULL,
  loaded_at     timestamptz NOT NULL DEFAULT now()
);

-- ---- rounds, unnested from programs[].rounds for querying ----
-- (programs.rounds jsonb remains the source view; this table exists so
--  "what's open / closing soon" queries don't have to unnest jsonb by hand)
CREATE TABLE IF NOT EXISTS registry_rounds (
  id            bigserial PRIMARY KEY,
  program_id    text NOT NULL,                    -- references registry_programs.id
  idx           int NOT NULL,                      -- position within the program's rounds list
  name          text,
  status        text,                              -- announced | open | reviewing | closed | deployed
  opens         text,                              -- source dates aren't always full ISO (e.g. "2026-03"); kept as text, not `date`
  closes        text,
  size          text,
  source        text,
  loaded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, idx)
);

-- ---- awards (registry/awards/<year>.jsonl, append-only in files) ----
CREATE TABLE IF NOT EXISTS registry_awards (
  key           text PRIMARY KEY,                  -- dedupe key from the jsonl record
  funder        text,
  funder_name   text,
  grantee       text,
  grantee_name  text,
  amount        numeric,
  currency      text,
  amount_text   text,
  award_date    date,
  program       text,
  program_name  text,
  wire          text,
  source        text,
  year_file     text,                               -- which registry/awards/<year>.jsonl this came from
  data          jsonb NOT NULL,
  content_hash  text NOT NULL,
  loaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registry_orgs_roles        ON registry_orgs USING gin (roles);
CREATE INDEX IF NOT EXISTS idx_registry_orgs_systems       ON registry_orgs USING gin (systems);
CREATE INDEX IF NOT EXISTS idx_registry_programs_org        ON registry_programs (org);
CREATE INDEX IF NOT EXISTS idx_registry_rounds_program       ON registry_rounds (program_id);
CREATE INDEX IF NOT EXISTS idx_registry_rounds_status         ON registry_rounds (status);
CREATE INDEX IF NOT EXISTS idx_registry_awards_funder           ON registry_awards (funder);
CREATE INDEX IF NOT EXISTS idx_registry_awards_grantee           ON registry_awards (grantee);
CREATE INDEX IF NOT EXISTS idx_registry_awards_program            ON registry_awards (program);
CREATE INDEX IF NOT EXISTS idx_registry_awards_date                 ON registry_awards (award_date);
