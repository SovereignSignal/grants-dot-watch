# Funding API v2 preview

This implements the first schema, read API and owner-reviewed import slices of the funding-data plan. The corpus migration and production rollout are not complete.

## Compatibility and activation

The v1 serializer, loader, enums, canonical registry records and counts remain unchanged. V2 enrichment lives in strict JSONL sidecars under `registry/program-terms`, `registry/funding-events` and `registry/process-metrics`. Legacy mutation behavior is preserved in `committer-legacy.ts`; its gateway adds v2 validation and conflict checks when funding participates.

Two independent, default-off gates exist:

- `GRANTS_WATCH_API_V2=1`: public read-only v2 routes.
- `GRANTS_WATCH_FUNDING_DESK=1`: authenticated preview/queue intake and owner-reviewed funding writes.

This PR sets neither in production. Public API responses use GET/HEAD/OPTIONS, explicit field allowlists and no-store caching. Invalid sidecars or an incomplete controlled snapshot produce a whole-request 503, never partial data disguised as success. Funding mutations stay under the existing authenticated Desk boundary, outside the public API.

## Read resources

`GET /api/v2` advertises eleven collections: systems, orgs, programs, rounds, awards, recipients, program-terms, funding-events, process-metrics, sources and opportunities. Each supports `/{id}`.

Collections accept `limit=1..100` (default 50), `cursor`, `q`, and resource-specific filters advertised by the index. Unknown, empty and repeated parameters are rejected. Instrument, capital form, selection model, event type and wire enums are checked. Cursors bind to the collection, filters and selected public snapshot. Data changes return 409 and require restarting the scan; historical server-side snapshots are not retained.

New ledger keys are persistent. Legacy round IDs are derived from program ID and round name, so renaming a legacy round changes its derived ID. Do not treat that derived ID as an immutable primary key for integrations.

## Funding semantics

Instruments, allocation methods, resource components and selection routes are independent fields. New quantities use exact decimal strings with currency/unit, qualifier and source wording. Mixed resources are never summed or converted automatically. Evidence includes a source, checked date, categorical evidence state and supporting paraphrase. Complete multi-source, field-level assertions and reuse-rights catalogs remain future work.

Historical terms stay scoped to their cohort/round. Conflicting unlinked versions do not silently select a newest winner. Explicit supersession is validated; an expired replacement cannot revive an earlier superseded offer.

Funding events have a stable award ID and a unique event key. Recommendation, approval, award, contract, payment, refund and challenge remain distinct. Payment/refund/clawback dates are required for those types and forbidden on non-payment events. No endpoint sums lifecycle events as independent capital. Legacy awards retain `payment_state=not_established` in the v2 view.

## Actionable opportunities

Rule revised 2026-10-10 to follow the Ledger decision: dated facts, not expiring "verified open" checks, and never program activity alone.

An opportunity is an open round on an active program whose own dates say it is open today, with somewhere to apply. The window must have started (`opens` on or before today, or absent), its `closes` date and any exact `closes_at` cutoff must not have passed, and dates must be exact. The application route is a matching access record's route, else the program's `apply_url`. Rounds without one are excluded.

Program terms enrich an opportunity and can veto it; they are not required. A terms record vetoes the round when its evidence is not primary-supported, its intake is `closed`, `no_unsolicited` or `nomination`, its selection includes invitation, internal selection or donor direction, or its access record for that round is closed or refuses new applicants or prerequisites. Conflicting unlinked terms veto rather than pick a convenient version.

Each opportunity states its `basis`:

- `access_check`: an access record for this round is open and inside its review window.
- `published_deadline`: the round has a published close date that has not passed. An access check past its review date no longer hides such a round; it just stops being the basis, and its date stays in `checked_on`.
- `rolling_intake`: the round has no close date, and primary-supported terms state rolling intake.

An undated open round with neither a current access check nor rolling-intake terms is excluded, because no deadline will ever retire it. Terms-less opportunities carry null `instruments`, `capital_forms`, `selection_models`, `eligibility`, `geography`, `entry_stage` and `terms_key`, and do not match instrument, capital-form or selection filters. Unknown eligibility/geography remain null; eligibility is not personalized. An opportunity is a listing of a published open call, not a guarantee that a particular applicant qualifies or that the call is still accepting entries.

## Import and review

Read `docs/funding-desk.md` for the authenticated preview, queue, owner approval and recovery protocol. Queueing never itself approves or changes canonical funding records. Curator/machine approvals are rejected. Source blob guards and snapshot checks prevent stale proposed facts from overwriting newer state. A shared control file coordinates replica outboxes; approved funding files replay through the existing recovery path.

For a disposable review copy, the staging CLI remains dry-run by default:

```sh
npm run validate
node scripts/stage-funding-import.mjs --pack research/v2/spotify-pilot.json
node scripts/stage-funding-import.mjs --pack research/v2/yc-investment-pilot.json --write-stage /tmp/grants-yc-preview
node scripts/validate-registry-v2.mjs --root /tmp/grants-yc-preview/registry
```

The CLI has no direct apply mode and never overwrites an existing staging directory. It preserves source registry bytes, detects baseline drift, and deduplicates repeated imports. Use it against an uncontrolled review baseline for this pilot. Importing into a Desk-controlled snapshot must use the Desk flow so its control record and durable outbox advance together.

Three candidate packs are retained outside canonical ledgers: historical Spotify sponsorship awards, Y Combinator's two SAFE components, and Zealynx's audit-invoice subsidy structure. They preserve cash versus restricted services and offered terms versus actual awards. Disputed indicative Zealynx dollar ceilings and unverified payment/access facts remain unset.

## Verification and remaining scope

CI validates the legacy registry and sidecars, checks the public boundary, lints the added implementation, runs unit/CLI tests and real PostgreSQL integration tests against an isolated CI service, typechecks, builds the application and runs browser/HTTP tests. Database tests still skip during local runs without `TEST_DATABASE_URL`; report those skips honestly. Read the current commit's CI receipt rather than assuming prior successful checks cover new changes.

Remaining: populated nonproduction rollout and rollback rehearsal, broader research backfill, source adapters, all remaining research controls, field-level provenance/rights, public changes/history, output and impact joins, quota/billing systems and production activation. No schedule or paid data pipeline is enabled by this PR.

## Additive registry profile fields

Organization list/detail/export records expose `socials` (public URL values for
x, github, forum and instagram) and `funding` (focus, typical_size, cadence,
apply_url). Absent funding is null; absent scalar subfields are null and focus is
an array. These are recorded organization profile facts with the organization's
`sources`, not newly verified terms. Unsupported nested fields are not published;
URLs pass the v2 public-URL guard.

Systems expose their existing `funding_channels` program IDs. These are navigation
anchors, not proof of capital ownership. Programs expose `allocation_methods` and
`intake_mode` alongside existing typed axes using the same `current_terms_key`
selection. Missing, disputed, round-only or conflicting terms produce null summary
fields. Full historical and round-scoped terms remain available separately.
Legacy `legacy_mechanism` and all v1 shapes/filters remain unchanged. See
[registry conventions](registry-conventions.md) for taxonomy and identity rules.
