# Funding v2 pilot release checklist

No production activation has occurred. The feature branch has no canonical funding rows, and its research packets are candidates for review.

Before a populated nonproduction rollout:

1. Confirm the current PR head passes registry validation, public boundary checks, lint, unit tests, PostgreSQL integration, typecheck, build and browser tests.
2. Use a dedicated nonproduction database and a copy of the registry. Never point test helpers at a production database; they truncate their fixture tables.
3. Keep the public v2 read gate separate from the funding Desk write gate. Preview one candidate packet, inspect its normalized facts and sources, and queue that exact plan digest.
4. Approve through the single-item owner Desk path. Verify the pending proposal, prepared/ready outbox transition, sidecar bytes and funding-control digest. The conservative pilot admits one reviewed snapshot at a time. Re-preview other packets after a successful import.
5. Restart into a clean image and confirm the approved outbox restores all sidecars. Confirm a second fresh restart is idempotent and does not mark data Git-synced. Keep the existing archival/deployment-confirmation workflow.
6. Inject a stale baseline and a failed verdict handoff in the test environment. Confirm refusals, claim holds and the absence of replay for merely prepared intents.
7. Inspect API collection/detail outputs, currency/unit semantics, null dates, access gating, page cursors and response time with populated data.
8. Close the write gate for rollback. Compare canonical files with prepared/ready receipts before manually clearing any writer lock. Do not expire a lock by age or blindly replace a controlled snapshot.

Pilot limitations: no bulk funding approval contract, no hot-reload across already-running replicas, no field-level multi-source provenance store, and no automatic claim that source-stated transfers were independently verified. All serving replicas need the same funding-aware code before write activation. Start with one nonproduction replica; promotion to multiple replicas requires rollout and conflict rehearsals.
