# Registry closeout review

Reviewed September 26, 2026 against main `b9ef3729`. This package contains the 15 records held out of the Ledger release: four new programs, two new organizations and nine updates. It preserves current main corrections, all Rocket Pool round history, the closed Round 40 status and all five Commons Fund rounds.

| Records | Change and current evidence |
| --- | --- |
| Humanity AI organization and Communities Leading on AI | Add the operator and its US community call, with the October 21 deadline at 4:59 p.m. Pacific, $75,000 to $1 million grants and $10 million total. [Official call](https://humanityai.ai/open-call/). |
| NIH Kidney AI Discovery Challenge | Add the announced challenge. Submissions run November 5, 2026 to April 29, 2027. The $100,000 purse and cash-prize eligibility are stated on the [NIH page](https://www.nih.gov/challenges/kidney-artificial-intelligence-discovery-challenge-nebulae-nephrons), now read directly. |
| NLnet organization, Restack and CodeSupply | Correct the named November 3 calls, noon CET cutoff and new cadence. Restack allocates EUR 7 million to grants through 2030; CodeSupply reserves EUR 400,000. [Call](https://nlnet.nl/news/2026/20260903-call.html), [Restack](https://nlnet.nl/restack/), [CodeSupply](https://nlnet.nl/codesupply/). |
| NLnet Fediversity, TALER and Commons Fund | Record continuing program delivery while keeping final application rounds closed and application links absent. [Fediversity](https://nlnet.nl/fediversity/), [TALER](https://nlnet.nl/taler/), [Commons Fund](https://nlnet.nl/commonsfund/). |
| Two legacy NLnet general-call records | Retain history and mark independent program identity unresolved. The shared current call establishes named funds; it does not establish another independent fund. [Current announcement](https://nlnet.nl/news/2026/20260903-call.html). |
| ELFA | Preserve the former NLnet association. NLnet withdrew, and the consortium advertises future subgrants without the checked pages identifying a live application route or call operator. [Withdrawal](https://nlnet.nl/ELFA/), [consortium](https://elfaconsortium.eu/). |
| Rocket Pool GMC | Add Round 41, closing October 7 at 23:59 UTC, without reopening Round 40. [Official forum call](https://dao.rocketpool.net/t/round-41-gmc-call-for-grant-applications-deadline-is-october-7/4043). |
| Solana Mobile organization and builder program | Give Solana Mobile its own operator record and retain the documented any-time application route and milestone-based support. [Official grant page](https://solanamobile.com/grants). |

The existing API regression checks now verify that continuing delivery with closed intake stays off the application board, and that the shared November deadline appears under the two named funds. Review dates reflect this source check. Historical event dates are retained.

Validation: 177 tests passed with PostgreSQL and no skips; 17 browser checks passed; registry validation, loader preflight, public boundary, lint, types and production build passed. Prepared registry totals: 484 programs, 416 organizations, 21 systems and 2,650 awards.

This review package does not create a Desk owner verdict or resolve refused historical outbox rows. Its publication status is tracked by the pull request and deployment receipts.
