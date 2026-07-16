# High-Impact Evidence Batch

Date: 2026-07-16 PDT

## Result

This batch reviewed 25 thin program records that had an application URL but no confirmed status,
round, or mechanism. Each record was checked against current primary evidence and registry
references before editing.

| Area | Result |
| --- | ---: |
| Programs reviewed | 25 |
| False or duplicate routes removed | 14 |
| Supported program records repaired | 11 |
| Related canonical programs repaired | 4 |
| Organization profiles repaired | 5 |
| New sourced organizations added | 1 |
| Expired July 15 rounds advanced to review | 4 |
| Programs after | 588 |
| Organizations after | 406 |
| Semantic review candidates after | 0 |

No removed route had an award, child program, or system funding-channel reference. Optimism Season
9 was retained and linked under the canonical Optimism Growth Grants program because it has an award
record.

## Removed Routes

| Route | Reason |
| --- | --- |
| `abundance-house` | Paid residency, not a funding program |
| `alchemy-arbitrum-grant` | Duplicate of `alchemy-arbitrum-grant-program` |
| `avalanche-accelerator-builder-grants` | Vague social placeholder duplicating specific Avalanche programs |
| `avalanche-builder-hub-grants` | Directory page presented as one grant program |
| `celo-community-grants` | Applicant submission for NaijaLancers |
| `drips-partners-with-unicef` | Donation and funding-mechanism pilot, not an applicant program |
| `durham-university-secures-funding` | Single-recipient award news |
| `grow3dge-accelerator` | External Scroll funding proposal |
| `laude-institute-moonshot-program-seed-grants-for-trustworthy` | Duplicate of `laude-moonshots` |
| `microsoft-second-round-funding-for-alpha-omega-and-openssf-a` | Funding announcement for named recipients |
| `nvidia-ai-startup-compute-credits-program` | Unsupported placeholder duplicating NVIDIA Inception |
| `quadratic-accelerator-q-acc-on-scroll-season-1` | Scroll governance proposal, not an approved program |
| `starknet-accelerator` | Unsupported funding-map claim absent from Starknet's current grant catalog |
| `starknet-announces-grant-programs` | Umbrella announcement duplicating Seed and Growth Grants |

## Repaired Programs

| Program | Correction |
| --- | --- |
| Aptos Payment Grants | Linked to the Aptos parent program; paused; up to $150,000; closed round |
| Avalanche Build Games | Concluded prize competition; six weeks; $1 million pool |
| Avalanche infraBUIDL(AI) | Paused while final allocations complete; up to $15 million |
| EIC Accelerator | Active hybrid grant and investment program; 2026 call open through November 4 |
| FIR Protocol RFP | Reassigned to Blueprint Biosecurity; closed January 23; global-health RFP |
| CSET Foundational Research Grants | Active grant program; AI-safety classification; applicant link removed |
| NSF X-Labs | Active funding opportunity; official portal; initial topics and federal R&D classification |
| Optimism Grants Council Season 9 | Concluded child of Growth Grants; application link removed; award preserved |
| Scroll Community Grants Support Program | Concluded three-month pilot; $200-$10,000 awards; SCR 312,500 budget |
| Unichain Conditional Funding Markets | Concluded $900,000 pilot with two documented market rounds |
| World Foundation Mini App Grants | Active rolling Spark and Scale grants; 50 million WLD allocation |

Related repairs consolidated the Alchemy-Arbitrum application route, corrected Aptos funding-size
language, moved the Season 9 round under its child program, and marked both Avalanche infraBUIDL
programs as winding down.

## Organization Repairs

- Added a sourced Blueprint Biosecurity nonprofit profile.
- Replaced the placeholder World Foundation profile with its current grants and application model.
- Replaced the placeholder Scroll profile with source-backed funding activity.
- Corrected Aptos Foundation's unsupported blanket grant-size range.
- Updated Avalanche Foundation and Starknet Foundation descriptions to match current programs.

## Audit Controls

The program-quality audit now also detects:

- paid or participant-funded programs incorrectly stored as grants
- partnership stories stored as programs
- single-recipient stories using "secures funding"
- umbrella announcements that duplicate canonical programs
- applicant requests for feedback on an EOI or application
- unsupported `manual/needs-source` placeholders
- proposal summaries using "this proposal is submitted"

Fixture tests cover every new signal.

## Deadline Rollover

Four rounds closed on July 15 and were still marked open. Their round states now read `reviewing`,
and stale application links were removed where present:

- Anthropic AI for Science
- eBPF Foundation Academic Research Grant Program
- Gray Area / Modal AI Arts Open Call
- OpenAI Foundation People-First AI Fund

## Current Coverage

| Coverage field | Programs missing it |
| --- | ---: |
| Confirmed status | 279 |
| Dated or explicit rounds | 348 |
| Mechanism | 257 |
| System classification | 438 |

These are evidence-enrichment gaps. They should continue as source-backed batches rather than bulk
defaults.

## Primary Sources

- https://aptosnetwork.com/grants/payments
- https://build.avax.network/build-games
- https://www.linkedin.com/posts/avalanchefdn_the-avalanche-foundation-is-evolving-how-activity-7450150985282371584-nGlp
- https://eic.ec.europa.eu/eic-funding-opportunities/eic-accelerator_en
- https://www.nsf.gov/funding/initiatives/nsf-x-labs
- https://cset.georgetown.edu/foundational-research-grants/
- https://blueprintbiosecurity.org/u/2025/11/Blueprint-Biosecurity-FIR-Protocol-RFP.pdf
- https://forum.scroll.io/t/introducing-community-grants-support-program/1164
- https://www.uniswapfoundation.org/blog/grant-opportunity-usd900k-available-for-unichain-lending-protocols-through-conditional-funding-markets
- https://www.uniswapfoundation.org/blog/unichain-cfm-pilot-case-study
- https://world.org/grants
- https://www.starknet.io/grants/
