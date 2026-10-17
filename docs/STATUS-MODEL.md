# Ledger implementation

The status model and public styling follow REDESIGN.md. The original HTML in
`design/mocks/ledger-evergreen/` supplies the homepage and program-page layouts,
copy, spacing and typography. Those files were committed in Claude’s handoff at
`115c955`; the running app had not yet incorporated them.

## Baseline

The clean `grants-watch-v1` checkout matched the handoff:

| Check | Result |
| --- | --- |
| Dependency installation | Passed; npm reported two unapproved install scripts |
| Unit and integration | 179 tests: 144 passed, 35 skipped without Postgres |
| Types | Passed |
| Production build | Passed |
| Browser | 12 passed |
| Public boundary | Passed |

The initial browser attempt could not bind its local server inside the execution
sandbox. The same suite passed after the local server was permitted.

## Changes

Program status comes from `program.status`. Application method follows the
first-match rules in REDESIGN.md. The next deadline is the earliest eligible
open or announced round on or after the product date. An exact source time is
shown without converting it to the visitor's zone; a passed clock time does not
change a calendar fact before the product date advances.

Review expiry no longer hides public facts. Deadline check dates require round
attribution; missing dates and sources remain explicit. Month-only dates keep
that precision. Round counts omit a "since" date when any round lacks a date.

The directory has one entry per program and filters for status and application
method. Organization and ecosystem counts use active programs. The front page
uses the original Ledger composition: search, the register, three wires,
ecosystems, latest awards and funding methods. Counts and lists come from the
registry. Full registry names and deterministic sorting can differ from the
shortened names and example rows in the mockups. No deadline listings appear
on the front page.

The owner approved replacing labels and counts on `/programs` while retaining its
existing departures and cadence layouts. Their inventory and pagination remain
unchanged. The shared masthead and typography follow the Ledger. The directory
and program pages use paper, ink and rules in place of rounded cards. The old
dark palette and theme control have been retired because no dark Ledger design
was approved. Newsreader uses variable optical sizing, as in the original HTML.

The initial v1 implementation left the internal review queue, research producers and
registry untouched. No paid provider requests were made. The main-based release now
incorporates the separately reviewed Wire Room backend and approved round closures.

## Initial v1 validation

- Unit and integration: 144 passed, 35 skipped without Postgres.
- Disposable local Postgres: all 179 passed; the database server was stopped.
- Python research-loop tests: 23 passed.
- Browser: 14 passed, including homepage navigation, registry counts, award links,
  program facts, search, mobile menus and a 320px viewport with dark system settings.
- Visually checked the homepage at 1440px and 390px, plus the program page, against
  Claude’s original HTML and PNGs.
- Types, build, registry validation, loader preflight and public boundary passed.
- Project lint passed with the local generated `.remember` folder excluded.
  The unqualified lint command reports one warning in that folder.
- The release audit found six dependency vulnerabilities. Compatible updates to
  Next.js, its lint configuration, Sharp, PostCSS and affected transitive packages
  brought the audit to zero vulnerabilities. A clean install and build passed.

## Release boundary

The release uses main's current registry and preserves its public API, briefing and query
routes. Backend PR #19, head `f5d82f5`, is integrated locally with the ten approved round
closures. Main's remaining registry corrections and removed duplicates are preserved.
The Ledger port restores awards search and keeps the departures board's standing-row
deduplication. The internal health page combines existing diagnostics with storage failure
and review-date reporting.

The combined release passes 162 PostgreSQL-backed tests and 17 browser tests. Its types,
build, lint, registry validation, loader preflight and public boundary pass. The dependency
audit is clean. This test set differs from the original v1 baseline because it starts from
main and the reviewed backend instead of importing the unreleased research producers.

Fifteen individually reviewed v1 data proposals remain pending approval. They are not
required to publish the Ledger UI against the existing registry. See
[LEDGER-RELEASE.md](LEDGER-RELEASE.md) for the exact data decisions and publication plan.
The combined frontend branch has not been pushed or deployed. Production release approval
is the remaining shared-state step.
