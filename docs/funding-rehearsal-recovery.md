# Railway rehearsal: recovery defect and release gate

## Observed on October 4, 2026

The separate grants-watch-v2-rehearsal project uses a fresh PostgreSQL database, one app replica and no production credentials or ingest jobs. The base revision was 71d96d4e3bd9af3c514fe39f819aa4e0f2ef5649; the first candidate was 0c1a233588139ce3acebe60954dbd307de4dfa93.

The three reviewed packs imported successfully through the real HTTP Desk flow: three program-terms records and three Spotify award events. Unauthenticated requests, stale preview digests and repeated approvals were refused. All eleven collections/detail reads worked. Full v1 collection fingerprints stayed equal: 21 systems, 416 organizations, 487 programs, 2,650 awards.

A Railway in-place restart retained the writable container filesystem. Boot replay saw the newest shared funding-control file and marked the first two outbox rows abandoned, although those rows contained the only durable copies of distinct Spotify and YC shards. The current replica still served all six records, masking the loss of recovery eligibility. A subsequent fresh deployment selected only the third row and refused its missing control-file base. This is a generic replay lifecycle defect exposed by the funding-control chain.

## Fix

A locally superseded ordinary approval is skipped on that replica but remains ready and unsynced in the shared outbox. Only the existing explicit registry PR #31 migration exceptions may be abandoned here. A replica's current bytes do not prove that the build image or another replica contains those bytes. Git synchronization and deployment confirmation remain responsible for archival.

The PostgreSQL suite now checks a warm restart followed by a fresh container, three shared-control/immutable-shard imports across repeated warm restarts, concurrent warm/cold replicas, and stale diagnostic clearing. Existing divergence, atomic writes, explicit migration exceptions, pagination limits and once-per-process behavior remain covered.

## Recovery and rollback constraints

The failed rehearsal database retains all original file payloads. A staging-only repair may restore the two accidentally abandoned rows only after verifying their IDs, approved proposals, unsynced state, recorded failure reason and the original whole-outbox fingerprint. Do not run a broad UPDATE or use this as an automatic production repair.

Do not select the original unpatched baseline as a generally safe rollback target while unsynced funding imports exist: another warm restart of that old binary repeats the defect. A rollback artifact must include this recovery fix, or have all required data independently archived and verified. Disabling v2 read/write gates does not disable boot replay.

This document records the defect and intended verification. It is not a passing rehearsal receipt. Production remains unchanged; populated fixed-image restart/replacement/rollback results must be recorded separately before release.
