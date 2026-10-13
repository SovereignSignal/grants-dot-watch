# First representative registry cleanup — 2026-10-13

These three packets are **unpublished review candidates**, compatible with the
existing v2 Funding Desk. No canonical YAML, JSONL shard, production verdict or
ledger row is changed by this PR. Each packet adds one terms observation; Google
and NVIDIA explicitly supersede their previous program-level observation while
preserving it. No effective date is invented from the observation date.

## Before / after in the disposable preview

| Record | Before | Candidate after |
| --- | --- | --- |
| PHP 2027 core contractors | No typed terms; compensation described only in prose | `contract` / `cash`, application selection, sourced technical/legal eligibility; compensation amount and currency remain null |
| Google Cloud AI tier | Legacy `other`; v2 subsidy/cloud_credit, sparse requirements | Same types and separate annual credit components; adds issuer eligibility and usage restrictions; legacy value remains unchanged |
| NVIDIA Inception | Legacy `incubator`; v2 other/cloud_credit+service, sparse requirements | Same noncash types; adds membership criteria and exclusions; no investment or cash-grant inference |

The profile consumer now names each classification dimension and preserves source,
observation date and history. Numeric resource labels retain their explanatory
amount text, including Google's year-two 20% usage coverage. The API additively exposes allocation_methods and
intake_mode under the existing current-terms selection rules, organization socials
and funding profiles, and system funding_channels. V1 and stable IDs are unchanged.

## Sources and limits

Reviewed official pages on 2026-10-13:

- PHP: https://thephp.foundation/blog/2026/09/30/applications-for-2027-are-open/ — contractor intake, technical/legal eligibility, proposed work and no hiring guarantee. An offered contract is not an executed contract or payment.
- Google: https://cloud.google.com/startup/ai — Gemini-based offering, company age/funding stage, prior credit limit and issuer discretion. Year one is 100% eligible usage up to USD 250,000; year two is 20% up to USD 100,000. These are conditional credits, not cash or guaranteed awards. Eligibility summary is not exhaustive; linked terms still govern.
- NVIDIA: https://www.nvidia.com/en-us/startups/ — incorporated startup under ten years old, developer/website requirements and listed organization exclusions; profile upkeep and noncash benefits. Investor introductions do not establish financing. Intake/access remain unknown in this bounded enrichment, rather than certifying a working application path.

`source-receipts.json` records capture and extracted-text hashes plus field-level
line locators. Each packet binds its assertions to the extracted representation
and guarded program/organization Git blob hashes. Extraction retained nonempty
HTML text nodes in document order, omitted script/style contents and collapsed
whitespace. The full captured HTML/text remains local evidence, not published raw
source text. Hashes establish representation integrity, not issuer truth or rights.

## Safe application and remaining decisions

1. Re-read README's ledger operating rules and the current controlled snapshot.
2. Preview one packet through the existing Funding Desk. Review and queue its
   current plan digest; only the owner verdict can publish it.
3. Re-preview the next packet after any approved change. A changed registry or
   control invalidates saved previews. Do not copy the disposable preview's
   shards or funding-control into the production checkout.
4. Let the designated sync owner handle the normal ledger sync/deployment flow
   only after separate authorization. This draft does not authorize that flow.

The test `funding-registry-cleanup.test.mjs` simulates the Desk change planner in
an isolated temporary copy, checks control integrity, all YAML blob guards,
unchanged funding events and retained evidence, then checks API and site profile
projections. The working registry validates with 240 terms; the temporary copy
has 243. Both have 535 programs, 435 organizations, 225 funding events and 16
process metrics. No broad completeness claim follows from those counts.

The follow-up approved identity convention is implemented in the separate
[PHP/NumFOCUS preview](../program-rounds/README.md), retaining both old call IDs.
Apply the terms packets first, then those guarded identity proposals; the original
PHP terms stay attached to its call and are displayed at the named parent round.
Rocket Pool's evergreen program/round structure is retained.
See [registry conventions](../../../docs/registry-conventions.md). No organization
type is invented, no scheduler/parser/LLM maintenance is introduced, and no
production data is changed.

## Local validation

Passed on the M5 with existing dependencies and Node 26.8.1 (CI uses Node 22):
public-boundary check, legacy/v2 validation, strict loader preflight, full ESLint,
TypeScript, production build, dependency audit (zero vulnerabilities), 474 unit
and integration tests with zero skips against isolated PostgreSQL 18, and 31
headless Chromium route/browser tests. The three candidate profiles additionally
passed desktop/mobile rendering, API packet-key checks and narrow-width overflow
checks in a separate temporary preview. Canonical registry data stayed unchanged.
