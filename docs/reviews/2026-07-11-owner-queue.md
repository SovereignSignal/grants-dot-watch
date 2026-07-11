# Owner queue — exception triage (2026-07-11)

Slice: `merge_orgs` (never-auto) + all `profile_note` items from the pending Desk queue. 39 items total.
8 decided (4 approved, 4 rejected) where the call was unambiguous by the registry's own laws — see notes on
each verdict in the Desk for the full reasoning. The 31 below still need Sov. One line each:
**[id] type · title · recommendation · why · evidence**.

## Merges (8) — investigated, none executed

| id | pair | recommendation | why |
|---|---|---|---|
| [p00154](/) | google ⟷ google-org (google.org) | **no action — already resolved** | Only `orgs/googleorg.yaml` exists; "google" and "google-org" appear nowhere else in the registry or queue. Google.org (fetched live) is Google's philanthropic arm, distinct from parent Google/Alphabet — already correctly modeled as one file. |
| [p00149](/) | x1-ecochain ⟷ x1-eco-chain (x1ecochain.com) | **no action — already resolved** | `orgs/x1-ecochain.yaml` is canonical; the only "x1-eco-chain" reference (`programs/x1-eco-chain-ecosystem-fund.yaml`) already has `org: x1-ecochain`. |
| [p00152](/) | national-science-foundation ⟷ nsf-techaccess (nsf.gov) | **no action — already resolved** | NSF's `aka` list already includes "NSF TechAccess"; `programs/nsf-techaccess-ai-ready-america.yaml` already has `org: national-science-foundation`. |
| [p00151](/) | national-science-foundation ⟷ nsf-x-labs (nsf.gov) | **no action — already resolved** | Same pattern — `aka` already includes "NSF X Labs"; the program file already points at `national-science-foundation`. |
| [p00153](/) | bnb-hack ⟷ bnb-chain (bnbchain.org) | **no action — already resolved** | Both `bnb-hack-*` program files already have `org: bnb-chain`. "BNB Hack" is a hackathon brand, not a separate legal entity. |
| [p00155](/) | zetachain-grant-program ⟷ zetachain-grants (zetachain.com) | **no action — already resolved** | Org's `aka` already includes "ZetaChain Grants"; both `zetachain-grants*` program files already have `org: zetachain-grant-program`. |
| [p00150](/) | crc ⟷ sia-foundation (sia.tech) | **unclear — leave for owner** | No "crc" org file or any reference to "crc" exists anywhere in the registry; web research found no organization named CRC connected to Sia/sia.tech. Possible parsing artifact — CRC is also the ISO 4217 code for Costa Rican Colón. Check the raw signal source before acting. |
| p00273 (`profile_note`, flagged as a duplicate) | schmidt-futures ⟷ schmidt-sciences | **merge schmidt-futures → schmidt-sciences** | Read both files directly: `schmidt-futures.yaml`'s own profile already says its site "now redirects to Schmidt Sciences" and its `aka` already lists "Schmidt Sciences." `schmidt-sciences.yaml` is the fuller, current record (funding block, live program). Same funder, old name → new name. |

## Editorial (11) — well-evidenced prose profile/summary rewrites, left pending only because they're prose

| id | title | recommendation | evidence |
|---|---|---|---|
| p00159 | Mozilla Foundation — MTF reframed as historical, apply_url fixed to Incubator | **approve** — matches accuracy-audit WRONG #1 | mozillafoundation.org/en/what-we-do/grantmaking/incubator/ |
| p00160 | Second Look Research — profile corrected (no "Request for Replications" program) | **approve** — matches accuracy-audit WRONG #2 exactly | secondlookresearch.com/replications |
| p00164 | Shuttleworth Foundation — profile states confirmed 2022 closure | **approve** — matches accuracy-audit WRONG #3 | en.wikipedia.org/wiki/Shuttleworth_Foundation |
| p00076 | Patch the Planet — OpenAI Daybreak maintainer-security initiative | **approve** | openai.com/index/patch-the-planet/ |
| p00138 | Ethereum Foundation — narrower, longevity-focused direction (paraphrases Vitalik) | **approve**, light copyedit — most interpretive of the batch | x.com/vitalikbuterin/status/2058583593102844111 |
| p00140 | Avalanche Foundation — CFRP passes 150 applications | **approve** | x.com/AvalancheFDN/status/2064744164198388055 |
| p00141 | Circle — Developer Grants relaunch ties to Arc | **approve** | circle.com/grant |
| p00113 | Rust Foundation — AI Security Engineer in Residence | **approve** | alpha-omega.dev/blog/an-ai-security-engineer-in-residence-for-the-rust-ecosystem/ |
| p00143 | Red Hat — IBM/Red Hat $5B open-source security commitment | **approve** | newsroom.ibm.com/2026-05-28-ibm-and-red-hat-commit-5-billion... |
| p00074 | Linux Foundation — LFX Mentoring stipend model change | **approve** | linuxfoundation.org/blog/strengthening-lfx-mentoring... |
| p00347 | Pacifica — profile's "no builder programs" claim is outdated | **approve** — corroborated by a companion new_program proposal | pacifica.gitbook.io/docs/programs/builder-program |

## Ordering-blocked (3) — nothing actionable yet

| id | title | recommendation | why |
|---|---|---|---|
| p00146 | olmo-open-language-model should be replaced by an Ai2 org file | **approve, structurally safe** | Confirmed via grep: nothing else in the registry references `olmo-open-language-model`, so removing it orphans nothing. Still a file remove+create, not a field edit — wants sign-off, not a rubber stamp. |
| p00296 | Shuttleworth fellowship intake dates look current but linked docs are dated 2013 | **no action possible** | `proposed_change` is empty. Genuinely blocked pending direct outreach to fellowship@shuttleworthfoundation.org. |
| p00297 | Apache Software Foundation — cited source for Responsible AI/Tooling Initiative now 404s | **no action possible** | `proposed_change` is empty. Needs a replacement source before the $10M Responsible AI Initiative claim can be reverified. |

## Ambiguous (9) — genuine judgment calls or unresolved evidence

| id | title | recommendation | evidence |
|---|---|---|---|
| p00252 | Foresight Institute — site says quarterly deadlines, registry says monthly | **CONFIRMED live** (I fetched it): "Application deadlines are on the last day of every quarter... Next deadline is September 30." Not left pending for lack of evidence — left pending because the fix touches prose in both the program and org files. | foresight.org/grants/grants-ai-for-science-safety/ |
| p00148 | ECMWF — `eu-public-rd` tag conflates an intergovernmental operator with an EU program | Taxonomy call, not a fact — owner decides whether to keep the loose tag or add a precise one | ecmwf.int |
| p00270 | Hedera — "Hedera Foundation" (hedera.foundation) vs. profile's "Hashgraph Association" | Unclear if rename, second funding arm, or different entity | hedera.foundation |
| p00301 | Chainlink — Community Grant Program not discoverable on 3 checked pages | Proposal itself says this doesn't confirm it's dead — spot-check directly with Chainlink Labs first | chain.link/blog |
| p00295 | Web3 Foundation — dead apply_url, current site funnels to /funding-support | Owner call: add a successor program file, or reframe the existing (correctly `concluded`) one | web3.foundation/funding-support |
| p00292 | KelpDAO — no grants program found on either domain, only a bug bounty | Owner review of whether `roles:[funder]` should be downgraded/removed | kerneldao.com/kelp/ |
| p00304 | Protocol Labs — "PL R&D" (plrd.org) may be a rebrand of the paused research-grants program, or separate | Owner determines the relationship before any status change | plrd.org |
| p00312 | GoodDollar — named programs (GoodBuilders, Prosperity Grants) replaced by a generic Typeform intake | Owner verify renamed vs. folded vs. just not surfaced | gooddollar.org |
| p00294 | Polygon — dead `/grow` source now redirects to an unrelated squatted domain | Owner check Polygon forum/Questbook for a live Season 3 before editing | polygon.technology |

---

## Decided (8) — full reasoning in each Desk verdict note

**Approved (4):** p00157 (CNCF project counts, confirmed 36/39/151 live), p00158 (Google Chrome fund name → "Advanced Web Apps Fund", confirmed), p00165 (SERI MATS → "MATS (MATS Research)", confirmed — the only one of the four that actually landed in the file; see note below), p00169 (Responsible Technology Youth Power Fund amount range → $25k–$100k, confirmed against two independent sources).

**Rejected (4):** p00144 (zcash sources_add — target `registry/orgs/zcash.yaml` doesn't exist), p00162 (Shuttleworth status → "closed" is not a valid enum), p00163 (Shuttleworth website → proposed value is prose, not a URL), p00167 (Mozilla program status → proposed value is a sentence, not a valid enum).

**Note on the 3 no-op approvals:** `profile_project_counts`, `profile_fund_name`, and `summary_amount` aren't fields the committer's writer recognizes (see `src/lib/committer.ts` `ORG_SET_FIELDS`/`PROGRAM_SET_FIELDS`) — approving them recorded the verdict but produced zero file diff. The three corrected values above are confirmed-correct and still need a manual registry edit.
