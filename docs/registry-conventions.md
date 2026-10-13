# Registry classification and identity conventions

The registry describes funding entities, their programs, offered support and history.
Missing terms or organization type mean unknown, not absence of funding. A system
association does not establish ownership; organizations can legitimately have no
recorded programs. Use the existing YAML and v2 evidence model.

## Classification

Legacy `mechanism` remains byte-compatible in YAML and `/api/v1`; `/api/v2` calls
it `legacy_mechanism`. It mixes different questions:

| Legacy value | Dimension | Relation to v2 |
| --- | --- | --- |
| grants | Instrument | `grant`, only when supported by terms |
| prize | Instrument | `prize`, only when supported by terms |
| retro | Allocation method | `retroactive`; instrument separately evidenced |
| quadratic | Allocation method | `quadratic`; instrument separately evidenced |
| fellowship | Program format | May also be v2 `fellowship` when supported |
| incubator | Program format | No automatic investment, grant or equity inference |
| rfp | Solicitation | No automatic contract or application selection inference |
| other | Unspecified legacy category | Does not override more specific v2 terms |
| absent | Not recorded | Remains distinct from an explicit `other` |

Never generate typed terms from that table alone. Preserve four independent v2
axes: `instruments` (what arrangement), `capital_forms` (what resource),
`allocation_methods` (how support is allocated), and `selection_models` (how
recipients enter selection). `intake_mode` is a separate access characteristic.
An empty array records no classification on that axis; `other` is an explicit
supported category. Null summary fields mean no unique current primary-supported
program-level terms. Unknown compensation is null, not zero.

Google's subsidy/cloud_credit and NVIDIA's other/cloud_credit+service are useful
distinctions. Keep credit components and restrictions separately; do not call them
cash. A PHP contractor call can offer a `contract` instrument without establishing
a `contracted` funding event. Legacy awards and lifecycle events are overlapping
views, never disjoint totals to add together.

The public profile shows each terms record with its source, observation date,
round/validity scope and evidence caveats. It retains superseded observations.
The program API summary selects only a unique current primary-supported
program-level record, with `current_terms_key` linking to the full evidence.
Round-specific terms remain on `/program-terms`; they must not become evergreen
program-wide claims. V1 filters and legacy labels stay compatible.

## Programs, subprograms and rounds

- A program is the durable funding vehicle. Repeated calls with the same purpose,
  operator and basic support model belong to its `rounds` history.
- A subprogram has a distinct continuing identity, purpose or eligibility under
  a parent. `parent` records that relationship, not a year or call number alone.
- A round records one named application window, cohort or allocation cycle. Keep
  separate cutoffs separately and attach historical terms with `round_name`.
- A genuinely one-off initiative can remain a program with one round. Its
  concluded status does not mean the organization ceased operating.

Apply this convention to new records and unambiguous additive enrichment. Do not
rename or move existing identities merely for consistency: v2 round IDs derive
from program ID plus exact round name; terms, events and historical links use
those values. Any consolidation needs a reviewed crosswalk and preservation of
sources, chronology and inbound links.

Rocket Pool Round 42 already belongs under `rocket-pool-gmc-grants` and follows
this convention. The approved bounded PHP/NumFOCUS preview now implements it
using an optional `parent_round` annotation on preserved call records:

- PHP gains `php-foundation-core-development-contractors`, with a `2027 contractor
  intake` round. Its existing 2027 page and original `Current call` round remain
  available and explicitly point to the parent round.
- NumFOCUS gains its existing `2025 Round 2` history on the enduring Small
  Development Grants program. The misleading but stable child ID
  `numfocus-sdg-2026-round-2-cfp-open-due-oct-17` remains available and points to it.

These are explicit issuer-supported mappings, not identity guesses from URL/title
similarity. Keep original source facts, terms keys, awards, events and round IDs.
Only the enduring parent appears in main program and current-call listings;
compatibility rows stay in full API exports with canonical round pointers.
Ordinary subprograms have a parent but no parent_round. See
[the review packets and reproducible preview](../research/v2/program-rounds/README.md).

## Review and ledger boundary

See README's ledger operating rules. No hand-editing approved YAML, immutable
Desk shards or `funding-control.json` before coordinated sync/deployment
confirmation. Research packets under `research/v2/representative-cleanup` are
unpublished candidates. Preview each against the current controlled snapshot,
queue and obtain the owner verdict through the existing Funding Desk, then use
its normal ledger sync process. Preview the next packet after each approved
change; a saved digest is not portable across changed snapshots. Draft PR review
is not a production Desk verdict.
