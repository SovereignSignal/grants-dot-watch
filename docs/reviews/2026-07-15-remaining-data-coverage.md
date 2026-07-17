# Remaining Registry Coverage

Updated: 2026-07-16 PDT

## Current State

The semantic cleanup queue is clear. `npm run audit:programs` reports zero semantic candidates
and zero unreferenced semantic candidates across 573 programs.

The remaining gaps are source coverage, not known structural defects:

| Coverage field | Programs missing it |
| --- | ---: |
| Confirmed status | 237 |
| Dated or explicit rounds | 342 |
| Mechanism | 221 |
| System classification | 423 |

## Working Rule

Do not fill these fields through inference or bulk defaults. A record should gain a status,
round, mechanism, or system only when a primary source supports it. The strict validator,
semantic audit, and owner-gated Desk remain the controls for every change.

The July 11 owner queue is a historical snapshot. It must be reconciled against the live Desk
and current sources before any remaining proposal is approved. Stale queue text is not an
instruction to mutate the registry.

The round-coverage count increased by one because a single Gitcoin proposal had been represented
as a program-wide rolling round. Removing that false precision is an accuracy improvement, even
though it leaves the program without a confirmed current round.

## Completion Boundary

Engineering cleanup is complete when the validator, semantic audit, unit tests, browser tests,
typecheck, build, GitHub CI, and production smoke checks pass. Registry enrichment continues as
new evidence arrives and is not a finite launch blocker.
