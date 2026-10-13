# Funding Desk pilot

Status: implemented on the v2 feature branch, behind an independent write gate. No production import or deployment is implied.

## Review flow

Set `GRANTS_WATCH_FUNDING_DESK=1` only in a controlled test or rollout environment. POST `/api/desk/funding` using the existing Desk admin authentication. The first request is `{ "mode": "preview", "pack": <candidate pack> }`. Review returned additions and `plan_digest`. The second is `{ "mode": "queue", "pack": <same pack>, "plan_digest": <reviewed digest> }`. Queueing returns 202 and does not approve or write canonical funding data. The existing Desk owner approval path then applies the queued proposal.

The packet carries at most 100 records for exactly one existing program. It uses the existing owner-only `profile_note` proposal class with a reserved `_funding_v2` envelope. The mutation gateway routes that envelope explicitly and rejects malformed/mixed payloads. It never silently falls through to a prose-only profile edit. Curator and machine verdicts are forbidden. There is no new auto-approval lane.

The gateway delegates legacy behavior to `committer-legacy.ts` when no funding feature/data participates. The optional `parent_round` compatibility annotation uses that same guarded proposal/serializer path; ordinary unannotated v1 records keep their existing shape. See `docs/registry-conventions.md`.

## Durability and conflicts

Imports create immutable JSONL shards plus a shared `registry/funding-control.json`. The control binds the entire funding snapshot. It is part of the same prepared Postgres outbox row and compare-and-set chain. While funding writes are enabled, legacy Desk mutations join that control chain too, preventing two replicas from accepting incompatible snapshots into disjoint files. Referenced registry bytes and prepared changes are rechecked after async intent persistence.

The control is written before funding shards. Concurrent readers fail validation until the complete logical snapshot is present. Missing controls for Desk-generated shards also fail closed. File-level rollback and boot replay use the existing implementation. A fresh container replays only `ready` rows; verdict failure leaves the intent `prepared` and the claim on reconciliation hold. Boot replay never marks a row Git-synced.

A local writer lock serializes cooperating processes on one disk. After a process crash, inspect the pending claim, filesystem snapshots and durable intent before removing `.data/funding-writer.lock`; there is intentionally no age-based unlock. Stale queued snapshots require another preview and queue revision. This conservative policy trades batch throughput for review fidelity during the pilot.

## Pilot coverage

Candidate packs remain under `research/v2/`, outside canonical ledgers:

- Spotify: historical sponsorship terms and three EUR award announcements, no inferred payment dates.
- Y Combinator: two SAFE investment components, preserving different conversion conditions. They are offered financing, not grant awards.
- Zealynx: audit-invoice subsidy structure and restricted services. Retrieved official pages disagree on indicative tier dollar amounts; those amounts and current access were deliberately withheld.

Each pack can use the staging-only CLI independently. The source blob guards bind the candidate to the exact organization/program files researched. No source adapter, fetch schedule, billing mechanism, or broad registry correction is enabled by these packets.

Primary source pointers: https://www.ycombinator.com/deal ; https://grants.zealynx.io/ ; https://grants.zealynx.io/rounds/season-2 ; https://engineering.atspotify.com/2026/1/congratulations-to-the-recipients-of-the-2025-spotify-foss-fund . Retrieved using Exa, Parallel and direct primary-page checks on 2026-10-04; two providers returning one page are one underlying source.

## Release checks

CI uses an isolated PostgreSQL service through TEST_DATABASE_URL, never production DATABASE_URL. New tests exercise queue/owner approval, denied curator verdicts, stale pending snapshots, failed verdict handoff, conflicting prepared intents, real fresh-process replay and unchanged synced_at. HTTP tests assert authentication, feature gates and existing API compatibility. Read the CI result for the current head before treating a gate as passed.

Remaining release work includes a populated nonproduction rollout, more mechanism/source adapters, field-level provenance/rights, a publication change feed, and measured API performance. Neither the 416-organization backfill nor the entire research roadmap is complete.
