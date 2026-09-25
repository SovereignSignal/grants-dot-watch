# Wire Room correction handoff

This release starts from the live registry. It ports the existing research intake and guarded Desk persistence implementation without bringing in the divergent registry or Ledger frontend.

## Boundaries

Wire Room owns observations and editorial status. grants.watch owns accepted public facts. Capture does not publish a program or accept a correction. New programs, rolling calls, awards, unresolved leads, withdrawals and changed terms are retained for review. An owner prepares a sourced correction against an exact program file hash and accepts it through the existing Desk. The intake supports summary/eligibility evidence, application URLs, operating status and replacement round assessments. It does not infer these fields from prose.

`wire:<entry-id>` remains the source identity. Versioned proposal signals append a substantive hash. Accepted single-target Desk proposals establish mappings; ambiguous targets remain unresolved. A Wire Room program ID is carried as source evidence, never substituted for a registry slug. Duplicate-parent changes are evidence too.

Revision hashes exclude observation timestamps, CRM counters and known scan-date boilerplate. They retain source descriptions, terms, statuses, classifications and relevant organization fields. PostgreSQL timestamps are preserved to microseconds with an entry ID tie-breaker. Source selection includes changed organizations and all entry statuses.

## Preview and persistence

The on-demand CLI consumes a previously captured array of at most 200 source rows. It performs no source/provider calls. Run from the repository root with the appropriate destination configuration already supplied securely:

```sh
node --experimental-strip-types --experimental-loader ./tests/ts-loader.mjs scripts/wire-handoff.mjs --input snapshot.json
```

Review the report and its plan hash. Saving requires that exact hash:

```sh
node --experimental-strip-types --experimental-loader ./tests/ts-loader.mjs scripts/wire-handoff.mjs --input snapshot.json --save --expected-plan REVIEWED_HASH
```

This writes only research evidence and any explicitly prepared Desk proposals. It never installs a consumption checkpoint or approves registry changes. The authenticated `/api/ingest/research` route provides the existing packet preview/save interface and recent research receipts. Capture receipts remain in `ingest_state`, with a recent-run index capped at 50.

A batch persists every packet and outcome before advancing its checkpoint. A partial failure leaves the checkpoint untouched, and deterministic packet IDs make retry safe. Proposed changes carry exact file hashes; concurrent owner edits reject the stale proposal at application time. Production storage fails closed if its database connection is unconfigured. Accepted writes use the durable outbox and are replayed on container restart.

## Release and activation gates

- Do not initialize `wire_handoff_v1` from the old creation-time cursor. First review a bounded historical replay against the current ledger and resolve coverage. The daily job remains unchanged until this explicit checkpoint exists; no new schedule is introduced.
- The timestamp query is not a commit-ordered change feed. Before unattended activation, account for long-running source transactions that commit behind an already-consumed timestamp, with a reconciliation pass or a source outbox. Current tests establish ordinary edit and equal-timestamp behavior, not that stronger guarantee.
- Existing legacy outbox rows without base hashes must be reconciled separately. Replay refuses missing/divergent files; never mark them accepted, archived or synchronized just to silence a warning.
- Registry validation, dependency audit, build and browser checks must pass on the combined backend/frontend release.
- Verify the public HTTP response after a real owner-approved correction and after restart. Fixture public serialization and local outbox tests alone do not prove production delivery.

The initial implementation is a reviewable capture and correction path. Historical migration and automatic consumption are deliberately not activated by deploying it.
