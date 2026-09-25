# grants.watch redesign: The Ledger

Direction approved by Sov on September 23 and 24, 2026. This document is the spec. The
mockups in [design/mocks/ledger-evergreen/](../design/mocks/ledger-evergreen/) show it.

## Decisions

1. **Look: The Ledger.** A 1920s wire service carried by typography. Paper ground, ink,
   hairline rules, a serif for reading and small caps for labels. It extends the July
   "Daily Ledger" system in [DESIGN.md](DESIGN.md). Two other directions were considered and
   dropped: a dark data terminal and a bold Swiss index.
2. **The front page is evergreen.** The hero says what the site is and offers search. Nothing
   on the front page needs a person to update it. Every number and list is computed from the
   registry.
3. **No deadlines on the front page.** Sov rejected a "deadlines on file" section twice.
   Deadlines appear only on each program's own page.
4. **Retire the verification labels.** Remove "Verified open", "Unverified", "Intake
   unverified", "Applications open" stamps and the weekly review expiry that flips them. Sov:
   "I hate these labels."
5. **Show dated facts instead of expiring claims.** Each program gives three facts: its
   status, how it takes applications, and its next published deadline with a link to where
   that deadline came from.

## Why

The verification model asked a person to re-check every open call every week. Only 12 of 485
programs ever carried it. Six expired on September 18 and the other six on September 26,
which would have shown zero open calls. A dated fact stays true: "closes October 7, published
by Rocket Pool" is still accurate a month later. "Verified open" is stale in a week. Under the
new model the site shows 305 active programs instead of 5.

## The status model

Every program shows these facts, derived from registry fields. No new claim expires.

**Status**, from `program.status`:

| Field value | Shown as | Note line |
| --- | --- | --- |
| `active` | Active | The program is running. |
| `announced` | Announced | Announced but not yet running. |
| `paused` | Paused | The funder has paused the program. |
| `concluded` | Ended | The program has ended. |
| `unknown` | Not recorded | Check the funder's site. |

**How to apply**, first match wins:

1. `review.intake_mode` is `rolling`, or the program has a round with status `open` and no
   `closes` date: show **Any time** with the note "The funder has not published a closing
   date."
2. The program has at least one round with a `closes` date, or `review.intake_mode` is
   `rounds`: show **In rounds**, with a note counting the rounds on file ("Five rounds on
   file since April 2026").
3. Otherwise: **Not recorded**, with "See the funder's site."

"By invitation" has no registry field yet. Add it only when the data carries it.

**Next deadline**:

- The earliest round whose `closes` is today or later (product date, see
  `productDateISO` in `src/lib/round-state.ts`) and whose status is `open` or `announced`.
- Show the date in full ("October 7, 2026"). If `closes_at` exists, show the time in the
  zone the source stated ("23:59 UTC", "12:00 CET", "16:59 PT"). Never invent a time.
- Under it: "Published by {funder} for {round name}." and a link to `round.source`, shown by
  host ("dao.rocketpool.net").
- "Noted {date}" only when a real check date exists for that round (`review.facts.deadline.checked_on`,
  or `review.checked_on` when the review names the round in `round_names`). Otherwise omit it.
- When no future deadline exists, show "No deadline on file". Once a date passes, the round
  moves to the round history as Closed. Nothing else changes.

**What to keep from the old model.** `review` blocks stay in the registry. Their
`checked_on` dates become the "noted" dates above, and `review.facts` still feed eligibility,
location and funding. They no longer gate what the public site shows.

## Visual system

**Colors**

| Token | Value | Use |
| --- | --- | --- |
| paper | `#F3EFE6` | Page ground |
| ink | `#17171A` | Text, rules, buttons, the mark |
| ink-2 | `#3E3D39` | Body text, secondary copy |
| dim | `#66635B` | Labels and captions (about 5:1 on paper) |
| hairline | `#CFC8B8` | Row rules and dividers |
| crypto | `#9A6512` | Wire marker only |
| ai | `#5B3FC4` | Wire marker only |
| oss | `#0A7189` | Wire marker only |
| link hover | `#1D5E3F` | Link hover only |

**Type.** Newsreader for headlines, body and numerals (italic numerals for counts).
Instrument Sans for labels: uppercase, 10 to 13px, weight 600 or 700, letter spacing 0.12em
to 0.16em. No monospace needed.

**Structure.** A 4px double rule under the masthead. Section heads are 13px Instrument Sans
caps over a 2px ink rule. Rows are separated by 1px hairlines. The mark is a 20px solid ink
square before "grants.watch" in Newsreader 600. A wire is marked by an 8 to 9px solid square
in its color.

**Remove everywhere.** Rounded cards, shadows, tinted chips, initials avatars, the sparkle
icon, blue buttons and the blue accent, the separate "Apply filter" step, and slogans.
Buttons are square, ink filled, with a caps label. Links are underlined with a 3 to 4px
offset.

**Copy rules** (from DESIGN.md, still binding). Plain prose, short sentences. No em dashes.
No aphorisms or slogans: display text describes the product or states a fact. Every page must
make sense to a first-time visitor.

## Front page

Top to bottom. Every count is computed at request time from the registry.

1. **Masthead.** Mark and name on the left. Nav on the right: Programs, Organizations,
   Ecosystems, Awards, About. A double rule. Under it: "The registry of the funding world" on
   the left and "Crypto · AI · Open source" on the right.
2. **Hero.** Kicker "From the Grant Wire". Headline "The registry of the funding world."
   Deck: "Grant programs across crypto, AI and open source: who funds them, what they fund and
   how to apply. Every fact links to its source." Search labelled "Search {N} programs and
   {M} organizations", placeholder "Try zero-knowledge, Mozilla or AI safety", ink Search
   button. To the right, a boxed "The register" with four counts: active programs,
   organizations, ecosystems, awards.
3. **The three wires.** Three columns: "The crypto wire", "The AI wire", "The open source
   wire". Each has a one-line description, its count of active programs, "Most programs"
   listing the four organizations with the most active programs in that wire, and a
   "Browse {wire} programs" link.
   - Crypto: "Protocol foundations, DAOs and ecosystem funds."
   - AI: "Public agencies, labs and philanthropies funding AI research and safety."
   - Open source: "Foundations and public funds for open software and infrastructure."
4. **Funding ecosystems** with a sidebar. Intro: "Some funding gathers around a blockchain.
   Some gathers around a field of work. Each ecosystem page lists its funders and their
   programs." Two lists split by `system.kind`: "Protocol ecosystems" (`protocol-ecosystem`)
   and "Funding areas" (`funding-domain`). Each row is the system name and its count of
   active programs, sorted by count. Hide systems with no active programs here, and link
   "All {N} ecosystems". Sidebar: "Latest awards" (the four newest awards that have a full
   date and an amount, then a link to the awards ledger) and "How to read a program": "Each
   program page gives three facts: whether the program is running, how it takes
   applications, and its next published deadline. Each fact links to the page it came from."
5. **Ways to be funded.** Active programs per `mechanism`, in this order, with these
   definitions:
   - Grants: "Money for a proposed project, agreed before the work starts."
   - Fellowships: "Funding for a person, usually over a fixed term."
   - Requests for proposals: "The funder names a problem and invites proposals to solve it."
   - Incubators: "Funding plus hands-on support to start a project or company."
   - Prizes: "Awards for results, judged against a stated challenge."
   - Retro funding: "Rewards for work already done and shown to be useful."
   - Quadratic funding: "A matching pool, shared out by how many people back each project."
   - Other support: "Investment, token incentives and arrangements that mix several of these."
6. **Footer.** Double rule, then "grants.watch · The registry of the funding world" and "A
   Grant Wire publication".

## Program page

- Breadcrumb: Programs / {wire} / {funder}.
- Main column: a caps line "{funder} · {wire} · {mechanism}", the program name as the
  headline, the summary as a deck. Then "Who can apply" as a definition list of
  Eligibility, Location and Funding. A missing fact says so plainly ("Not recorded. Check the
  funder's terms."). Then "Round history": every round with its name, window, size and
  source, newest first. Rounds with a future close read "Deadline ahead", past ones
  "Closed". A note under the table: "Past rounds stay on the page, so you can see how often
  this program opens."
- Right column: "The facts" box with Status, How to apply and Next deadline as defined above.
  Then an ink button "Apply on {host}" linking to `apply_url`, and the line "You apply with
  the funder. grants.watch does not take applications." Then a "Funder" box linking to the
  organization page.

## Phone

A 20px gutter and touch targets of at least 44px. The masthead collapses to the mark, the name
and a menu button. The hero headline is 48px, and search stacks the field over a full-width
button. The register box stays 2 by 2. Sections stack in the same order as on desktop.

## Not decided yet

- **The /programs page.** Today it is a deadline-ordered departures board. The proposal is a
  plain directory of programs with status and how to apply. Sov has not confirmed.
- **Dark mode.** The Ledger has no dark design yet. The current navy and lavender dark theme
  should not carry over.
- **The About page.** Its copy is written around the old verification model ("'Open' is a
  claim we check.") and uses slogans. It needs a rewrite.

## About the mockups

The mockups use real registry data as of September 24, 2026: 485 programs, 305 active, 417
organizations, 21 ecosystems and 2,650 awards. The build must compute these live, never hard
code them. The mockups started on a private design canvas in Sov's Claude account. The copies
in this repository are the design of record.
