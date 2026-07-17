# Registry Accuracy Closeout

Updated: 2026-07-17 PDT

## Outcome

This pass completed the remaining unknown-status review and corrected related source, ownership,
mechanism, round, and system data discovered during that work.

| Census | Before | After | Change |
| --- | ---: | ---: | ---: |
| Organizations | 411 | 416 | +5 |
| Programs | 525 | 487 | -38 |
| Unknown status | 120 | 1 | -119 |
| Missing rounds | 276 | 217 | -59 |
| Missing mechanism | 157 | 42 | -115 |
| Missing system classification | 374 | 212 | -162 |
| Semantic review candidates | 0 | 0 | 0 |

The final status distribution is 337 active, 136 concluded, 9 paused, 4 announced, and 1 unknown.

## Decision Rules

- Prefer a current first-party program page, official announcement, governance record, or results
  notice.
- Treat status as application or participation availability, not whether funded work is still under
  way.
- Mark a dated cohort concluded after its deadline, winner announcement, or completed event.
- Use announced when a publisher describes a program but has not opened an intake.
- Leave status unknown when evidence establishes that a fund existed but does not establish current
  intake or closure.
- Remove unreferenced records that are duplicates, grantee stories, governance proposals, reports,
  directories, unsupported social claims, or non-cash giveaways.
- Do not infer an active intake from a live organization, an old application URL, or the absence of a
  closure notice.

## Material Corrections

The pass resolved current or historical status for 83 retained unknown-status records and added
mechanisms, dates, sizes, application routes, and durable summaries where the source supported them.
Examples include:

- 1inch Aqua incubator: active rolling intake with the actual application route
- BNB Chain $100M Liquidity Incentive Program: active based on 2026 foundation activity
- Canton Protocol Development Fund: active and reassigned to the Canton Foundation
- Deep Funding GG24 model contest: concluded after the May 10 deadline
- Google DeepMind Cognitive Evaluations: concluded after the April 16 deadline
- Hedera HelloFuture Apex: concluded with official winners published
- Mantle builder support: active rolling buildathons, with Scouts Season 2 recorded as closed
- NSF PESOSE AI Agent Ecosystems DCL: active and classified as an AI and open-source RFP
- Sia Foundation Grants: paused based on the foundation's June 25 intake notice
- Unichain Grants: active with the current official program page

Ownership corrections also reassigned records to Canton Foundation, Coefficient Giving, DIV Fund,
Google DeepMind, Longview Philanthropy, Manifund, Polygon, Strategic Animal Funding Circle, The
Chicken Coup, USDA, and Who Let the Docs Out. Five missing organizations were added to preserve those
relationships.

## Removed Records

The following 38 unreferenced records were removed after semantic and duplicate review:

- AI Enabled O
- Arbitrum LTIPP Research Bounty (PYOR)
- Crecimiento Uniswap Foundation Partnership
- ENS Academy
- exchgART + BONK Grants Program
- gemaker
- Gitcoin Deep Funding
- Gitcoin DAO 2026 Budget (Venture-Scale Grants)
- Google.org Impact Challenge: AI for Government Innovation
- Incentivized Delegation Vaults
- Longview Philanthropy Digital Minds RFP
- Mozilla Democracy AI Funding
- Open Phil Technical Safety RFPs
- OpenClaw Kimi Developer Grant
- PHP Foundation Ecosystem Security Team (Alpha-Omega)
- Polkadot Community Fund
- Quality Projects Grant Fund
- Revnets Autonomous Revenue Networks
- SafePal Solana Builders Grant
- RPIP-81: Rebalance RPL Inflation for Protocol Funding
- Schmidt Sciences Frontier Risk Grants
- Scroll Ecosystem Growth RFI
- Scroll Ecosystem Growth Subsidy Program
- Scroll Marketing Programme
- Scroll Retroactive Infrastructure Funding
- Scroll Sequencer Fees Fund Competitive Grants Program
- Scroll Sustainable Liquidity Initiative
- SuperDapp AI Agents Grants Program
- Superteam Microgrants
- Survival and Flourishing Fund Matched Grant
- The First Pillar: Protocol Governance
- The Three Pillars of Polygon Governance
- ARIA CommonAI Compute Grant
- Unichain Ecosystem Grant
- US Department of Education AI Tech Training Hub Grant
- Web3 Foundation New Era
- X1 Eco Chain Ecosystem Fund
- Zcash Grants Hub

Several removals preserve a corrected canonical record elsewhere in the registry. Others were
proposals, reports, directories, recipient announcements, or claims without enough publisher-backed
evidence to present as funding programs.

## Remaining Unknown

`rubicon-grants-fund` is the only unknown-status program. An Optimism governance thread confirms that
the Rubicon Grants Fund was approved and active in October 2024, including authorization to redirect
roughly 110,000 OP into it. No current intake, application route, or closure notice could be verified.
Its record now states that limitation directly.

## Verification

- Registry validation: pass, 21 systems, 416 organizations, 487 programs
- Program quality audit: pass, zero semantic candidates
- Whitespace and patch integrity: pass
- Full CI: pass, including public-boundary check, 18 unit tests, type checking, and production build
- Browser smoke suite: pass, 6 desktop and mobile workflows
- Dependency audit: 0 high or critical findings; 10 moderate findings in Privy's wallet dependency tree
- Live deployment smoke test: pending deployment

## Guidance For Future Imports

New records should not enter the public registry from a social post alone when the post describes a
proposal, recipient, report, or organization rather than a reusable funding program. Importers should
resolve the canonical program page, owning organization, current intake state, and duplicate program
before publication. If current status cannot be established, use `unknown` with a summary that states
the evidence limit instead of carrying promotional language forward.
