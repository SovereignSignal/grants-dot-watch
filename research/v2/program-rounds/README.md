# PHP and NumFOCUS: enduring programs, preserved call pages

This is the approved second bounded step in draft PR #65. It contains **unapplied
review proposals**, not canonical registry edits. The existing model's `parent`
and `rounds` gain one optional compatibility annotation, `parent_round`, so an old
call page can explicitly name its round on the enduring program.

| Case | Before | Preview after | Preserved behavior |
| --- | --- | --- | --- |
| PHP | 2027 contractor intake is a standalone program with a `Current call` round | New `php-foundation-core-development-contractors` program has `2027 contractor intake`; the old page names that parent/round | Old program URL/ID and original `Current call` v2 round ID return the original facts, with an explicit link to the parent round |
| NumFOCUS | 2025 Round 2 is a child program; enduring Small Development Grants has no rounds | `2025 Round 2` added to the existing enduring program; old child explicitly names that parent round | Old misleading `numfocus-sdg-2026-round-2-cfp-open-due-oct-17` ID/URL and original v2 round ID remain resolvable |

No old program, round, terms key, event, award, or source is deleted or renamed.
The original call records retain their existing summaries, status and round facts.
Main browse/current-call views show the enduring programs once. Full API exports
retain compatibility records with canonical round pointers. Distinct continuing
subprograms are unaffected.

## Evidence for identity

- [PHP's structure page](https://thephp.foundation/structure/) describes ongoing
  contracted PHP core development. The [2027 issuer call](https://thephp.foundation/blog/2026/09/30/applications-for-2027-are-open/)
  explicitly says the annual intake repeats prior years' practice. Together they
  support a continuing vehicle plus a 2027 intake, without inventing earlier
  round dates, budgets or contracting outcomes.
- [NumFOCUS's program page](https://numfocus.org/programs/small-development-grants)
  identifies its continuing microgrant program and explicitly lists Round 2
  under **2025 Funding Rounds**, with the October 17 proposal cutoff. That content,
  the existing parent link and the retained call facts support the mapping. A
  shared URL or similar title alone would not establish identity.

Checked 2026-10-13. The proposals preserve recorded dates and amounts; this step
adds no deadline refresh, 2026 NumFOCUS call, payment, or complete-history claim.
The NumFOCUS parent's recorded paused status is unchanged. PHP's annual terms
remain on the old call record and are displayed under its named parent round;
they do not become evergreen eligibility or a program-wide current-terms summary.

## Review artifacts and safe reproduction

- [PHP proposals](php.json): guarded creation of the enduring program, then a
  guarded link from the existing call. Two steps, in that order.
- [NumFOCUS proposal](numfocus.json): one guarded change set adds the historical
  round and links the existing call.
- [Machine-readable before/after](before-after.json): selected public program and
  round projections, original IDs, canonical pointers and source links.
- [Compatibility tests](../../../tests/program-round-reference.test.mjs) and
  [browser tests](../../../tests/browser/program-rounds.spec.ts).

From a checkout with dependencies available:

```sh
node --test --experimental-strip-types --experimental-loader ./tests/ts-loader.mjs tests/program-round-reference.test.mjs
```

The helper creates a new temporary directory, copies the committed registry,
restores each file the terms packets guard to its reviewed Git blob, freezes the
preview's clock at 2026-10-13 (the PHP call closed on 2026-10-20),
previews/applies the first three terms packets there, then prepares, validates and
writes these proposals through the existing committer and funding-control guard.
It does not queue proposals, record owner verdicts, connect to production or write
canonical repository files. It deletes the temporary copy after the test.

The test verifies stable old pages/API IDs, source/history preservation, no
unrelated record edits, no duplicate PHP opportunity, scoped inherited display,
and rejection of invalid references. The browser suite exercises old URLs and
parent anchors through a production build using the same disposable fixture.

## Application remains a separate authorized operation

No production state is inspected or changed by these packets. Coordinate with
the designated ledger sync owner under README's operating rules before any
application. Review against the then-current registry and ledger snapshot.
Apply/approve the existing three terms packets first; then preview and queue the
PHP and NumFOCUS identity proposals in the stated order through the owner-only
Desk path. Refresh stale hashes only after reviewing actual source/record drift.
Never copy preview YAML, shards or funding-control into production. Each approval
must use the normal durable ledger and subsequent sync/deployment confirmation.
Neither this draft nor this preview authorizes merge, deploy or production approval.
