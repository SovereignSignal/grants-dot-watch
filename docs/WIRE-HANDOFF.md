# Wire Room correction handoff

This release starts from the live registry. It ports the existing research intake and guarded Desk persistence implementation without bringing in the divergent registry or Ledger frontend.

## Boundaries

Wire Room owns observations and editorial status. grants.watch owns accepted public facts. Capture does not publish a program or accept a correction. New programs, rolling calls, awards, unresolved leads, withdrawals and changed terms are retained for review. (Wire captures never auto-apply awards. The separate daily award-source sweep can auto-apply clean first-party award packets when `AWARD_SOURCES_AUTO_APPLY=1`; see `docs/funding-live-product.md`.) An owner prepares a sourced correction against an exact program file hash and accepts it through the existing Desk. The intake supports summary/eligibility evidence, application URLs, operating status and replacement round assessments. It does not infer these fields from prose.

`wire:<entry-id>` remains the source identity. Versioned proposal signals append a substantive hash. Accepted single-target Desk proposals establish mappings to surviving registry records; conflicting surviving targets remain unresolved. A Wire Room program ID is carried as source evidence, never substituted for a registry slug. Duplicate-parent changes are evidence too.

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

## Retired program identities

An old approved proposal can point at a file intentionally removed during registry cleanup. Such a reference no longer resolves at runtime. For a reviewed consolidation, the operator may explicitly associate the Wire entry with an existing canonical program using `scripts/wire-mappings.mjs`. This is an identity decision, not permission to restore the retired contents, reopen a round, approve a correction or acknowledge an unsynced outbox row.

Keep real mapping packets private. A version 1 packet contains `reviewed_by`, `reviewed_at` (UTC ISO timestamp), and 1–200 `mappings`. Each mapping requires `wire_id`, `from_program_id`, `to_program_id`, `reason`, HTTP `evidence` URLs, `expected_target_hash` (SHA-256 of the exact destination YAML bytes) and `expected_history_hash` (from `wireHistoryHash` over the current approved Desk history). There must be one unambiguous historical target, that file must be absent, and the proposed destination must exist.

```sh
node --experimental-strip-types --experimental-loader ./tests/ts-loader.mjs scripts/wire-mappings.mjs --input mappings.json
node --experimental-strip-types --experimental-loader ./tests/ts-loader.mjs scripts/wire-mappings.mjs --input mappings.json --save --expected-plan REVIEWED_HASH
```

Save requires PostgreSQL, the exact preview hash and the existing ingest advisory lock. One atomic `ingest_state` document (`wire_identity_mappings_v1`) contains the append-only identity decisions and review evidence. Existing decisions cannot be overwritten through this command. All batch entries are validated before saving; a changed target, changed approved history or concurrent mapping acceptance invalidates the preview. Repeating an already accepted batch requires a fresh preview and performs no write.

At runtime, a unique surviving approved target takes precedence. A recovery decision applies only while the reviewed historical approval remains unchanged and its replacement retains the same ID and organization. Deleting the replacement or changing its funder leaves the source unresolved. Ordinary deadline edits preserve identity. Revoking or replacing a recovery decision requires a separately reviewed migration; this bounded command intentionally does not edit its audit history.

These decisions do not consume source observations or initialize `wire_handoff_v1`. Historical source capture and the activation gates below remain separate work.

## Release and activation gates

- Do not initialize `wire_handoff_v1` from the old creation-time cursor. First review a bounded historical replay against the current ledger and resolve coverage. The daily job remains unchanged until this explicit checkpoint exists; no new schedule is introduced.
- The timestamp query is not a commit-ordered change feed. Before unattended activation, account for long-running source transactions that commit behind an already-consumed timestamp, with a reconciliation pass or a source outbox. Current tests establish ordinary edit and equal-timestamp behavior, not that stronger guarantee.
- Existing legacy outbox rows without base hashes must be reconciled separately. Replay refuses missing/divergent files; never mark them accepted, archived or synchronized just to silence a warning.
- Registry validation, dependency audit, build and browser checks must pass on the combined backend/frontend release.
- Verify the public HTTP response after a real owner-approved correction and after restart. Fixture public serialization and local outbox tests alone do not prove production delivery.

The initial implementation is a reviewable capture and correction path. Historical migration and automatic consumption are deliberately not activated by deploying it.
