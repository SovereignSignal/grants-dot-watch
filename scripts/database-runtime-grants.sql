-- Apply as the migration owner after creating the dedicated LOGIN role.
-- The runtime does not own tables, migrate schema, reload the index or delete records.
-- Grant CONNECT on the target database separately; no hard-coded database name.
GRANT USAGE ON SCHEMA public TO grantswatch_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.desk_proposals, public.desk_verdicts,
  public.ingest_state, public.desk_applied_changes TO grantswatch_runtime;
GRANT USAGE ON SEQUENCE public.desk_applied_changes_id_seq TO grantswatch_runtime;
