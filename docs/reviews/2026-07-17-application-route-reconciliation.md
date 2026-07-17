# Application Route Reconciliation

Date: 2026-07-17

## Scope

Reviewed all 97 programs that were marked `active` but had no `apply_url` after the current-intake
reconciliation. The review used publisher-controlled program pages, application forms explicitly
linked by those pages, and official government opportunity pages.

## Changes

- Added 25 current application or submission routes.
- Corrected six records whose public intake state did not support `active`.
- Expanded thin records where official sources supplied current deadlines, award sizes, or process
  details.
- Left 66 records without an application route because they are invite-only, nomination-only,
  investment vehicles, deployed cohorts, recurring programs between calls, or programs whose public
  evidence does not expose a current intake.

### Application routes added

AI-BOOST AI Challenge Competition; Algorand xGov; BARDA Accelerator Network; CEPI Calls for
Proposals; Coefficient Giving Transformative AI RFP; COTI Builders Program; Decentraland DAO Grants;
Devcon 8 Community Hubs; Effective Altruism Funds; EuroHPC Research & Innovation Calls; Flow
Ecosystem Grants; Foresight Fellowship; Gitcoin Flows; Global Catastrophic Risks Opportunities Fund;
iExec Ecosystem Fund; IVADO R3AI Research Clusters; Lido LEGO; three NIH opportunities; Nominet DNS
Fund; Polkadot Treasury Proposals; Stacks Community DeGrants; Sui Academic Research Awards; and The
Graph Grants Program.

### Intake status corrected

| Program | Previous | Current | Evidence |
| --- | --- | --- | --- |
| BARDA DRIVe EZ-BAA | Active | Paused | Official page says there are no open Areas of Interest. |
| CCC Research Fund | Active | Concluded | 2026 call closed June 1 and recipients were announced July 1. |
| Compound Grants Program | Active | Paused | Latest official renewal thread says the application process closed May 30, 2024. |
| Global Innovation Fund | Active | Paused | Official page says the last window closed January 15, 2025. |
| OpenAI Foundation AI Resilience | Active | Announced | Foundation describes grants being finalized, with no public application route. |
| Second Look Research Summer Fellowship | Active | Concluded | Its sole 2026 application round is closed. |

## Guardrail

An informational source was not promoted to `apply_url` unless it is itself the submission process or
the publisher explicitly links the application from that page. Missing public application routes remain
visible as missing rather than being replaced with search pages, social posts, or guessed forms.
