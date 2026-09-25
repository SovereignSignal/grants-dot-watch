# Ledger release reconciliation

## State

The Ledger frontend is prepared on the current main baseline (`0150371`). The approved
mockup source is retained in `design/mocks/ledger-evergreen/`. The existing public API,
briefing, query, method and departures-board deduplication remain available.

Backend PR [#19](https://github.com/SovereignSignal/grants-dot-watch/pull/19), head
`f5d82f5`, is integrated locally. It contains the guarded Wire Room correction backend
and the ten individually approved round-status closures. No other registry fields changed.
The original v1 working session is preserved. This combined release has not been pushed
or deployed. Main merge and production deployment require the final release approval.

## Data review

The three-way comparison found 142 differences: 102 changed only on main, 33 changed on
both branches, and seven changed only on v1. Preserve main's corrections and deletions.
The following 15 records have individual proposed changes. These are a review draft, not
applied registry writes. The ten expired-round status corrections were approved in the separate
Wire Room review and are already integrated. They are not part of this pending set.

| Record | Proposed decision |
| --- | --- |
| `registry/orgs/humanity-ai.yaml` | Add the funder for the sourced Communities Leading on AI call. |
| `registry/orgs/solana-mobile.yaml` | Record the program operator separately from Solana Foundation. |
| `registry/orgs/nlnet-foundation.yaml` | Use the reviewed profile, current named funds and corrected CET deadline. |
| `registry/programs/humanity-ai-communities-open-call.yaml` | Add the published October 21 call with its stated Pacific cutoff. |
| `registry/programs/nih-kidney-ai-discovery-challenge.yaml` | Add the announced challenge; official NIH search excerpt confirms dates, prizes and eligibility. Direct page fetch returned 403. |
| `registry/programs/nlnet-codesupply.yaml` | Add the first September 3 to November 3 call with noon CET cutoff. |
| `registry/programs/nlnet-elfa.yaml` | Retain a historical NLnet association and unknown operating status after its withdrawal. |
| `registry/programs/nlnet-foundation-open-call-apply-for-funding-deadline-2026-0.yaml` | Keep August round history. Mark the identity of this general announcement record unresolved. |
| `registry/programs/nlnet-general-grants.yaml` | Keep closed cadence history. Remove the unsupported attribution of a shared future call to a distinct general program; retain its evidence in review history. |
| `registry/programs/nlnet-ngi-fediversity.yaml` | Program delivery continues through November 2027; final intake remains closed. |
| `registry/programs/nlnet-ngi-taler.yaml` | Program delivery continues through August 2027; final intake remains closed. |
| `registry/programs/nlnet-ngi-zero-commons-fund.yaml` | Program activity continues through 2027; preserve all five recorded rounds and the final June 1 closure. |
| `registry/programs/nlnet-restack.yaml` | Correct the first call to September 3 to November 3 and grant allocation to EUR 7 million. |
| `registry/programs/rocket-pool-gmc-grants.yaml` | Append Round 41 without dropping Round 40 or its source. Preserve the closed Round 40 status from the approved backend correction. |
| `registry/programs/solana-mobile-builder-grants.yaml` | Correct the operator and retain the documented any-time application route. |

Sources checked during this reconciliation include the [NLnet September call](https://nlnet.nl/news/2026/20260903-call.html),
[CodeSupply](https://nlnet.nl/codesupply/), [Restack](https://nlnet.nl/restack/),
[Fediversity](https://nlnet.nl/fediversity/), [Taler](https://nlnet.nl/taler/),
[Commons Fund](https://nlnet.nl/commonsfund/), [ELFA](https://nlnet.nl/ELFA/),
[Humanity AI](https://humanityai.ai/open-call/),
[Rocket Pool Round 41](https://dao.rocketpool.net/t/round-41-gmc-call-for-grant-applications-deadline-is-october-7/4043),
and [Solana Mobile](https://solanamobile.com/grants).
The [NIH challenge](https://www.nih.gov/challenges/kidney-artificial-intelligence-discovery-challenge-nebulae-nephrons)
returned 403 on direct fetch; the indexed official page confirmed dates, prizes and eligibility.
Existing review check dates are retained, rather than representing this comparison as a full
renewal of each record's review.

The intended result adds four programs and two organizations. Rocket Pool's previous
Round 40 and its source remain. The NLnet general record retains its closed cadence history;
the shared future call is retained as evidence in review history rather than attributed to
an independent fund whose identity is unresolved. No retired Linux Foundation records return.

## Validation

The original v1 baseline matched HANDOFF.md: 179 tests, 144 passed and 35 skipped without
PostgreSQL; 12 browser tests passed. Its types, build and public-boundary checks passed.

The combined main-based release has a different test set: it preserves main's API and
recency coverage, adds the Ledger facts and cache coverage, and includes the reviewed
Wire Room backend. Unreleased research producer suites stay on v1.

- All 162 unit and integration tests passed against disposable local PostgreSQL, with no skips.
- All 17 browser tests passed against the production build, including the existing public API,
  briefing and awards search, plus Ledger facts and responsive navigation.
- Types, production build, lint, public boundary, registry validation and loader preflight passed.
- Dependency audit reported zero vulnerabilities after a clean install.
- Desktop and phone visual inspection retained the approved Ledger layout.
- Registry: 480 programs, 414 organizations, 21 ecosystems and 2,650 awards; 258 programs are active.
- Only the ten approved round-status changes differ from main's registry. All other files and
  fields remain intact. No bulk registry replacement was performed.

A data-specific NLnet assertion from v1 is held with the pending record reconciliation.
The browser suite checks the actual release registry instead of assuming those proposed
records have already been accepted. The independent program-facts tests continue to cover
application methods, deadlines, source attribution and review expiry.

The Wire Room handoff captures evidence for review. It does not automatically publish
registry changes, and its recurring checkpoint remains inactive. Existing refused legacy
outbox records stay refused. See [WIRE-HANDOFF.md](WIRE-HANDOFF.md) for activation boundaries.

## Publication plan

Publish the Ledger branch for review and CI, integrate backend PR #19 and the Ledger change
into main, then verify the Railway deployment on grants.watch. The existing main deployment
connection supplies subsequent approved builds. Do not activate the historical Wire replay,
initialize its consumption checkpoint, or accept the 15 pending data proposals as part of
this release unless separately approved.
