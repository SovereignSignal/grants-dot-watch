# Registry Accuracy Batch

Date: 2026-07-15 PDT

## Scope

This batch removes records that were not funding programs, consolidates duplicate routes, repairs
truncated summaries, and removes unsupported application links. Every deletion was checked against
award rows, child programs, and system funding channels before removal.

## Corrections

| Area | Result |
| --- | ---: |
| False or duplicate program routes removed | 82 |
| Removed routes with award, child, or system references | 0 |
| Unsupported funder-homepage application links removed | 112 |
| Truncated summaries repaired from complete source sentences | 97 |
| Programs before | 684 |
| Programs after | 602 |

Removed routes covered applicant submissions, nominations, help questions, governance and operating
budget proposals, reports, retrospectives, directories, single-award stories, and duplicate round
announcements. Valid records were retained when a source supported an actual funding mechanism.

The batch also consolidated Project Odin, Arbitrum Open House London, NLnet Commons Fund, Filecoin
DevGrants, Sui RFPs, Taiko Grants, ZetaChain Grants, the Uniswap Security Fund, and several other
duplicate routes into stronger canonical records.

## Audit Controls

The program-quality audit now detects:

- applicant submissions, nominations, help requests, and forum proposal sources
- governance artifacts, directories, reports, retrospectives, and single-award stories
- generated prompt text leaked into summaries
- summaries clipped during ingestion
- thin records whose application link is only the funder's root homepage

Fixture tests cover each signal. JSON output now flushes safely for large review queues.

## Primary Sources Used For Repairs

- https://blog.ethereum.org/2026/02/27/project-odin
- https://blog.arbitrum.foundation/open-house-london-registration-is-now-open/
- https://www.mozilla.org/en-US/moss/foundational-technology/
- https://openaifoundation.org/news/resilience-in-the-age-of-ai
- https://gov.gitcoin.co/t/gg24-public-goods-tooling-development-round-full-retrospective/25276
- https://www.comp.xyz/t/request-for-proposals-rfp-compound-dao-treasury-management-program/7867

## Remaining Boundary

The semantic review queue is clear. Remaining missing fields are evidence gaps:

| Coverage field | Programs missing it |
| --- | ---: |
| Confirmed status | 305 |
| Dated or explicit rounds | 372 |
| Mechanism | 283 |
| System classification | 460 |

These fields should only be added from primary evidence. Missing coverage is an ongoing research
queue, not a reason to infer or bulk-default facts.
