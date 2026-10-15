# Wire Room correction handoff

This release starts from the live registry. It ports the existing research intake and guarded Desk persistence implementation without bringing in the divergent registry or Ledger frontend.

## Boundaries

Wire Room owns observations and editorial status. grants.watch owns accepted public facts. Capture does not publish a program or accept a correction. New programs, rolling calls, awards, unresolved leads, withdrawals and changed terms are retained for review. (Wire captures never auto-apply awards. The separate daily award-source sweep can auto-apply clean first-party award packets when `AWARD_SOURCES_AUTO_APPLY=1`; see `docs/funding-live-product.md`. Wire new programs can auto-apply only under `WIRE_PROGRAM_AUTO_APPLY=1`; see "Wire program auto-apply" below.) An owner prepares a sourced correction against an exact program file hash and accepts it through the existing Desk. The intake supports summary/eligibility evidence, application URLs, operating status and replacement round assessments. It does not infer these fields from prose.

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

## Wire program auto-apply

`WIRE_PROGRAM_AUTO_APPLY=1` (default off) lets the daily ingest approve a Wire `new_program` for an organization already in the registry without an owner click. It runs inside the daily run's ingest lock and once-per-day claim, after the Wire ingest has queued the day's proposals, over every pending Wire `new_program` (today's and the backlog). There is no new scheduler. The validator itself still never approves a new program.

A proposal is approved only when all of these hold; otherwise it stays pending exactly as before:

- It came from the Wire ingest (`wire:` signal id), is not curator-queued, and no curator review says reject or needs owner. Its change is one `programs/<slug>.yaml` entry with only id, name, org, apply_url and rounds, and at most one round: the ingest's `Current call`, open or unstated, with only name, status, closes and source. A Wire amount (`size`) or an `opens` date leaves it for the owner.
- What gets published is plain and the org's own: the name has no markup or links; the proposal summary (it becomes the program summary) is 40 to 400 characters with no markup or links, and is published as filed, never rewritten; the payload cannot set systems, wires or a summary; the proposal's wire must be one of the org's wires.
- The organization is already in the registry and its website gives a registered domain. No new org, no merge.
- Every URL the record would carry (apply URL, evidence URL, round sources) is https on that domain or a subdomain, and the checked URL (the apply URL, else the evidence URL) is not the bare homepage.
- The Wire source score is 70 or more, and no deadline is before today's product date.
- No registry program has the same id, the same normalized name for that org, or the same apply URL, and nothing approved earlier in the run does.
- A server fetch of the checked URL succeeds, using the curator auto-apply fetcher (https, public addresses only, redirects only within the domain, 1 MB, 8 s). The page's visible text contains the program name as a whole phrase, and either an open/apply phrase (such as "apply now", "accepting applications") or the proposal's deadline written with its year. Every deadline the record carries must be on the page with its year. A closed phrase ("applications are closed", "deadline has passed", ...) leaves it pending.
- `decideProposal`, which re-runs the staged registry validation, succeeds, and the proposal it claims still hashes to the payload that was checked (`expect_change_hash`). A payload edited after the check is refused with `changed_since_check` and stays pending.

Name matching is normalized: lowercase, diacritics and markup removed, every run of punctuation or whitespace collapsed to one space. The accepted phrases are the program name, the title's core name (the part after `<org name> · `), and either of those with a leading org name or alias removed. A phrase counts only with at least two words, eight characters, and one word of three or more letters that is not generic (grants, program, fund, round, ...) and not a number. Scattered words do not count.

Approval is a machine decision through the Desk path with a `wire_program_auto_apply` audit (policy, fetched and final URL, page SHA-256, matched name, matched signal, score). The Desk Log labels it `machine · wire program auto-apply`. There is no one-click revert; undoing it is an owner edit. At most 15 pages are fetched per run, least recently checked first, one at a time. The run summary (approved, and each item left with its reasons) is `wire_program_auto_apply` on the `last_run` ingest record and one line on `/admin/health`. The rule lives in `src/lib/wire-program-auto-apply.ts` and is stated in `src/lib/machine-approval-policy.ts`.

## Release and activation gates

- Do not initialize `wire_handoff_v1` from the old creation-time cursor. First review a bounded historical replay against the current ledger and resolve coverage. The daily job remains unchanged until this explicit checkpoint exists; no new schedule is introduced.
- The timestamp query is not a commit-ordered change feed. Before unattended activation, account for long-running source transactions that commit behind an already-consumed timestamp, with a reconciliation pass or a source outbox. Current tests establish ordinary edit and equal-timestamp behavior, not that stronger guarantee.
- Existing legacy outbox rows without base hashes must be reconciled separately. Replay refuses missing/divergent files; never mark them accepted, archived or synchronized just to silence a warning.
- Registry validation, dependency audit, build and browser checks must pass on the combined backend/frontend release.
- Verify the public HTTP response after a real owner-approved correction and after restart. Fixture public serialization and local outbox tests alone do not prove production delivery.

The initial implementation is a reviewable capture and correction path. Historical migration and automatic consumption are deliberately not activated by deploying it.
