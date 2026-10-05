# Funding closeout checks

## What this change closes

A funding-aware reader now checks the durable approved control before serving a snapshot. A locally prepared write cannot appear in the public API before its owner verdict commits. Two already-running readers with separate filesystems catch up to later approved records without requiring redeployment. A failed database query, incomplete replay or concurrent writer returns a controlled unavailable response, without publishing a stale or unapproved snapshot.

The existing boot implementation is retained in `boot-replay-core.ts`. An explicit refresh wrapper, guarded by the same local writer lock used by funding-aware mutations, enables later catch-up. Ordinary legacy registry edits participate in the same control sequence after funding exists. A local replay never proves Git archival and never retires a ready unsynced approval.

These guarantees are checked by dependency-free coordination tests and by two independent Node processes using the real production reader and isolated PostgreSQL. The tests include a deliberately failed approval handoff. That writer refuses public reads while the second reader continues to serve the last approved snapshot.

## Logical backup and restore

`backup-restore.mjs` exports a repeatable-read PostgreSQL snapshot, fingerprints all supported non-system relation rows and schema definitions, uses an actual custom-format `pg_dump`, and restores into an explicitly named NEW database. It then compares row, schema and sequence fingerprints and tests fresh-filesystem recovery of the restored approved outbox.

Safety boundaries:

- Source operations are read-only and source/target database identities must differ.
- Only loopback or Railway private-network hosts are accepted.
- The target name must match `gw_restore_*`; existing targets are refused. No existing target is cleaned or overwritten.
- Database credentials are passed through the subprocess environment, never arguments or receipts.
- The temporary archive is deleted locally after verification; no database dump is uploaded by CI.
- Time, row, table and byte budgets are explicit. Unknown relation shapes and large objects require separate verification rather than a partial success.
- Ownership, ACLs and cluster-global objects are intentionally outside the logical-database receipt. This is not certification of a Railway volume snapshot or point-in-time recovery.

The end-to-end CI test approves a real source-backed packet, dumps/restores the populated fixture database, recovers its files into a fresh directory, and compares the resulting control. Corrupted restored rows and existing-target overwrites must fail. Test helpers refuse non-loopback production-like connections.

```sh
SOURCE_DATABASE_URL='...' TARGET_DATABASE_URL='...' \
EXPECTED_RESTORE_DATABASE=gw_restore_explicit_new_target \
ALLOW_NEW_RESTORE_DATABASE=gw_restore_explicit_new_target \
node scripts/funding-closeout/backup-restore.mjs
```

This command writes only its explicitly new target. It must not be pointed at an existing application database. A failed run leaves its target for inspection and does not delete it automatically.

## Live public verification

```sh
# Plans only; no network.
node scripts/funding-closeout/live-read.mjs

# Bounded, sequential GET/HEAD/OPTIONS checks. No owner token or publication.
node scripts/funding-closeout/live-read.mjs --fetch \
  --expected-commit EXACT_DEPLOYED_SHA \
  --require-control --out /tmp/funding-live-new-directory
```

The verifier scans all advertised collections through pagination, samples first/middle/last detail records, compares every JSONL export against the full scanned rows and recomputes snapshot hashes. It also scans all four v1 collections, validates OpenAPI routes, tests rejected filters and unauthenticated owner access, and checks populated website views. A changing deployment, inconsistent snapshot, duplicate cursor, invalid export or unavailable website view fails the run. HTTP success alone is not a pass.

The private workflow artifact contains only public API data and its receipt. No production credentials or raw private Desk records are captured. The request and byte budgets are fixed, with sequential pacing; measured response timings are a bounded smoke check, not a sustained-load guarantee. This workflow runs on relevant pull requests or explicit dispatch, not a recurring data-collection schedule.

## Still requires an independent platform receipt

The attempted Railway staging restore-target change requires two-factor confirmation in the dashboard. It was not applied through an alternate identity or API. Successful local/CI restore tests must not be described as a completed Railway production-backup restoration. Preserve the original staging application and PostgreSQL database; inspect the staged patch before human approval.

## Data coverage is a separate acceptance dimension

This closeout change does not manufacture new source evidence or declare the 416-organization historical corpus complete. Existing accepted records and explicit gaps remain the authority. Source redistribution rights, source-complete histories and causal impact claims require their own evidence. Do not equate a passing infrastructure test with complete grant data.
