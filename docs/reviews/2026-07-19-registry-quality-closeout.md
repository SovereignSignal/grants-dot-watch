# Registry Quality Closeout

Updated: 2026-07-19 PDT

## Outcome

This batch closes the finite accuracy and cleanup work identified in the July repo and live-site
reviews. It reconciles current deadlines, removes duplicate or unsupported records, replaces
placeholder copy, completes mechanism classifications, and adds regression checks for the import
errors found during review.

| Census | Before | After | Change |
| --- | ---: | ---: | ---: |
| Organizations | 416 | 415 | -1 |
| Programs | 487 | 481 | -6 |
| Unknown status | 1 | 1 | 0 |
| Missing mechanism | 42 | 0 | -42 |
| Fixed-deadline rounds named `Rolling` | 38 | 0 | -38 |
| Semantic review candidates | 0 | 0 | 0 |

The final status distribution is 304 active, 158 concluded, 13 paused, 5 announced, and 1 unknown.

## Material Corrections

- Retro9000 is paused between calls and C-Chain Round 5 is closed after its July 17 deadline.
- Google Data Center Community AI Fellowship is active because applications continue after the
  priority deadline while places remain available.
- NSF Future CoRe is active with its next proposal target date and official NSF sources. The prior
  third-party funding claim was removed.
- PIBBSS is consolidated under Principles of Intelligence with the current cohort, stipend,
  location, deadline, and application form.
- Foresight Fellowship is separated from AI for Science & Safety Nodes. The latter now has an
  explicit publisher-backed rolling intake.
- ENS delegation incentives and SPP3, Gitcoin GG24 programs, Interledger Fellowship, Solana perps
  grants, Sovereign Tech Standards, NSF SBIR, Google for Startups, and Thinking Machines grants now
  have specific mechanisms, rounds, amounts, statuses, and application routes where supported.
- ElevenLabs OSS Engineers Fund and Digital Chamber State Network Microgrants were added from
  publisher-controlled evidence.
- Every remaining program now has an explicit funding mechanism.

## Consolidated And Removed Records

Eight program records were deleted:

- Six duplicate records were merged into canonical Scroll, Foresight, Gitcoin, Google Summer of
  Code, and PIBBSS records.
- The Optimism Season 9 audit record was removed as a mislabeled duplicate of the broader Season 9
  growth grants record.
- The Ethereum Foundation dependency-mapping bounty was removed because the registry had only a
  third-party social post and no publisher-backed program evidence.

The duplicate PIBBSS organization was merged into Principles of Intelligence. Two newly verified
programs were added, producing the net change from 487 to 481 programs.

## New Accuracy Controls

- Registry validation now rejects any fixed-deadline round named `Rolling`.
- The quality audit now fails imported `dispatch from the wire` placeholders.
- The quality audit now detects additional editorial instructions leaked into summaries, including
  word-count directions, source instructions, and statements that an amount was not provided.
- Regression tests cover fixed-deadline rolling labels, dispatch placeholders, and editorial prompt
  leaks.
- The unused direct `@solana/kit` dependency declaration was removed. Privy may still install it
  transitively as part of its own dependency tree.

## Completion Boundary

The remaining 210 programs without rounds and 210 without system mappings are not a bulk-fix queue.
Some are standing programs without a dated call; others do not map cleanly to the curated 21-system
taxonomy. Add those fields only when a first-party source supports the round or the program has a
defensible relationship to an existing system.

`rubicon-grants-fund` remains the only unknown-status program. Available evidence confirms the fund
existed but does not establish a current intake or a closure. Keeping that uncertainty visible is
more accurate than assigning a status by inference.

Future work should focus on newly published calls, deadline rollovers, source drift, and owner-gated
imports. It should not reopen this batch solely to reduce missing-field counts.

## Verification

- Registry validation: pass, 21 systems, 415 organizations, 481 programs
- Program quality audit: pass, zero missing mechanisms and zero semantic candidates
- YAML parse check: pass, 917 files
- Unit tests: pass, 19 of 19
- Placeholder and prompt-leak scan: pass, no matches
- Whitespace and patch integrity: pass
- Full local release suite: pass, including public-boundary check, type checking, and production build
- Browser smoke suite: pass, 6 desktop and mobile workflows
- Dependency audit: 0 high or critical findings; 10 moderate findings remain in Privy's transitive
  wallet dependency tree, with no compatible upstream fix available
- GitHub Actions, Railway deployment, and production browser smoke: pending release
