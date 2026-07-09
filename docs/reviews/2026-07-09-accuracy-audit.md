# Registry Accuracy Audit — 2026-07-09

Adversarial fact-check of a random sample of the grants.watch registry (`registry/orgs/*.yaml`, `registry/programs/*.yaml`, `registry/awards/*.jsonl`), run by four parallel auditors against live web sources. Every claim was treated as wrong until confirmed. No registry files were edited by this pass — corrections below are proposals only, staged in `seed/proposals-batch-5.json`.

## Scorecard

| Type | Checked | ACCURATE | MINOR | WRONG | UNVERIFIABLE | Accuracy rate* |
|---|---:|---:|---:|---:|---:|---:|
| Orgs | 15 | 7 | 5 | 3 | 0 | 80.0% |
| Programs | 10 | 6 | 2 | 2 | 0 | 80.0% |
| Awards | 12 | 12 | 0 | 0 | 0 | 100.0% |
| **Overall** | **37** | **25** | **7** | **5** | **0** | **86.5%** |

\* Accuracy rate = (ACCURATE + MINOR) / checked. MINOR items are stale-but-not-misleading (redirected URLs, drifted counts, a missing social handle); WRONG items would send a BD person to a dead end, a wrong number, or a defunct program presented as live.

Severity notes on borderline calls: the four program-level "NEEDS CORRECTION" verdicts from the raw audit were split here into 2 MINOR (missing fellowship cohort; grant-range off by $25k on the low end but program otherwise live and correctly described) and 2 WRONG (a dead 404 apply link; a program marked "active" with no evidence of activity since 2024). One raw audit batch's own summary line ("7/10 clean, 3/10 need correction") does not match its own verdict array (6 CORRECT / 4 NEEDS CORRECTION) — this report uses the verdict array, not the prose summary, and flags the discrepancy for whoever maintains the audit pipeline.

## WRONG findings (would mislead a BD person)

1. **`registry/orgs/mozilla-foundation.yaml`** — Presents the Mozilla Technology Fund (MTF) as Mozilla's current, applyable fund with a working `apply_url`. That URL now redirects to Mozilla's generic grantmaking hub, which does not list MTF among its current programs. MTF ran exactly three cohorts (2022-2024, ~$1M total); no cohort has run since. Mozilla's actual live themed/mentored $50k program today is the "Incubator" brand (launched Nov 2025), running "Democracy x AI Cohort 2026." Evidence: https://www.mozillafoundation.org/en/what-we-do/grantmaking/incubator/

2. **`registry/orgs/second-look-research.yaml`** — Claims the org "recently launched a Request for Replications, hiring 10 graduate-level research fellows." No program of that name exists on the site; the fellowship page's own copy (pulled from the compiled JS bundle, since it's a client-rendered SPA that WebFetch/curl can't see directly) says a planned cohort of "roughly 7 in-person fellows, plus 1-2 program leaders" at $10,000 stipend each. Evidence: https://secondlookresearch.com/replications

3. **`registry/orgs/shuttleworth-foundation.yaml`** — Status is "unknown" ("current status is unclear" in the profile text), but the Foundation publicly announced its own closure in July 2022, effective "by the beginning of 2024," after 17 years and 56 fellows — confirmed independently via Wikipedia. Separately, the listed website returns a bare HTTP 404 on every path via direct curl; an AI-oriented fetch of the same domain returned content that varied suspiciously by URL slug, consistent with a lapsed domain now serving cloaked content to automated researchers. There is no live official Shuttleworth Foundation website. Evidence: https://en.wikipedia.org/wiki/Shuttleworth_Foundation

4. **`registry/programs/mozilla-foundation-technology-fund.yaml`** — Same root issue as #1 at the program level: `status: active` with no evidence of any MTF round since 2024; Mozilla's current grantmaking landing page doesn't list MTF among open programs. Evidence: https://www.mozillafoundation.org/en/what-we-do/grantmaking/

5. **`registry/programs/openssf-ti-funding.yaml`** — `apply_url` (`https://openssf.org/community/technical-initiatives/`) returns HTTP 404. Correct current URL: `https://openssf.org/about/tac/technical-initiative-funding/`. The specific "$70k-$150k" tier figures in the summary also could not be confirmed against the live page, which describes tiers only qualitatively.

## Dead / broken links found

- `registry/programs/openssf-ti-funding.yaml` — `apply_url` 404s. Correct URL: `https://openssf.org/about/tac/technical-initiative-funding/`.
- `registry/orgs/shuttleworth-foundation.yaml` — `website` 404s on every path (root and sub-paths, www and non-www); the domain shows signs of being cloaked for AI fetchers. No live official replacement exists (the Wikipedia-cited alternate domain is an explicit unofficial fan project).
- `registry/orgs/mozilla-foundation.yaml` — `funding.apply_url` for MTF is not technically dead (it 301→200s) but resolves to a generic hub page with no MTF-specific content — a soft dead-end for BD purposes.

No dead links were found in the 12-row awards sample; all 12 source URLs resolved and were on-topic.

## What this sample proves — and doesn't

This audit checked 37 records (15 orgs, 10 programs, 12 awards) against a registry of roughly 230 orgs, 75 programs, and something on the order of 2,800 award rows — a sample of roughly 1.3% of the total. Selection was systematic (alphabetical stride within each file type, not random), which avoids cherry-picking but also means the sample isn't a statistically random draw — clustering by alphabetical position could under- or over-represent certain naming patterns or entry vintages.

Within that sample, the awards ledger held up perfectly (12/12 verified against primary sources, no numeric or attribution errors, no dead links) — award rows appear to be sourced and entered carefully. Org and program profiles fared worse: 3 of 15 orgs and 2 of 10 programs checked were materially wrong, all clustering around the same failure mode — a funder's flagship program described as currently live/applyable when it has gone stale, been rebranded, or quietly shut down. That is a specific, identifiable risk (program-currency drift), not a general accuracy problem across the registry; it does not mean 20% of all 230 org profiles are wrong, only that stale "this program is live" claims are the highest-risk category found so far and are worth a targeted pass, not a full re-audit. The zero UNVERIFIABLE count across all four auditors also means every claim checked could be run to ground on the live web within one sitting — no structural blocker (paywalls, vanished sites, non-English sources) showed up in this sample, though it may exist elsewhere in the registry.

The honest conclusion: this sample is large enough to say "program-currency drift is a real, recurring failure mode worth fixing systematically" and to hand-verify the 14 specific corrections below with confidence. It is not large enough to certify the registry's overall accuracy rate, extrapolate a total error count across all ~2,900 records, or rule out other failure modes (e.g., wrong-org attribution, impersonation, fabricated amounts) that simply didn't appear in this particular 1.3% slice.

## Proposals filed

14 correction proposals were written to `seed/proposals-batch-5.json` (type `profile_note`, confidence 85, one per corrected field) covering all 7 MINOR and 5 WRONG findings — Shuttleworth Foundation generated 3 proposals (status, website, profile) since the underlying audit surfaced three distinct field-level errors in one file.
