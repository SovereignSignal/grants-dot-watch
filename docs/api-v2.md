# Funding API v2 preview

This is a staged implementation of the Notion funding-data plan. It is not the completed corpus migration or a production launch.

## Compatibility and activation

The v1 serializer, loader, enums, registry files and counts are unchanged. V2 enrichment lives in independent, strict JSONL sidecars under `registry/program-terms`, `registry/funding-events` and `registry/process-metrics`. The original draft widened the v1 enum and failed type checking; that change has been removed.

All v2 reads fail closed with 503 unless `GRANTS_WATCH_API_V2=1`. This PR does not set that variable, deploy, schedule collection, or change database access. GET/HEAD/OPTIONS only, public field allowlists, no-store responses. Invalid sidecars produce a whole-request 503 rather than empty success or partial data.

## Implemented routes

`GET /api/v2` advertises only working endpoints:

- `/systems`, `/orgs`, `/programs`, `/rounds`, `/awards`, `/recipients`
- `/program-terms`, `/funding-events`, `/process-metrics`, `/sources`, `/opportunities`

Each collection supports `/{id}`. IDs are opaque. Legacy round IDs derive from program ID and round name, so a rename changes that derived ID. New ledger keys must be persistent.

Collections accept `limit=1..100` (default 50), `cursor` and `q`, plus their documented filters returned by the index. Unknown, empty or repeated parameters are rejected. `instrument`, `capital_form`, `selection_model`, event type and wire enums are checked. Cursors bind to collection, filters and the selected public data snapshot. A changed snapshot returns 409 and requires restarting the scan. This detects intervening changes; it does not retain historical server-side snapshots. No undocumented mutation or bulk route exists.

## Data semantics

Instruments, allocation methods, resources and selection are independent fields. New quantities are nonnegative decimal strings with currency/unit, qualifier and source wording. Mixed packages are not summed or converted. Every sidecar has a source, checked date, categorical evidence state and a supporting paraphrase. Multi-source field-level assertions and richer legal terms remain future work.

Historical round-scoped terms stay scoped. Unlinked conflicting applicable terms do not silently choose a newest winner. Supersession is explicit and validated. Current program-level enrichment remains null if unresolved.

Funding events use an award ID plus a unique event key. Approval, award, contract, payment, refund and challenge are distinct. Payment/refund/clawback dates are required for those event types and forbidden on other events. No endpoint sums lifecycle records as separate capital. Existing v1 award rows retain an explicit `payment_state=not_established` in the v2 view.

## Strict opportunity projection

An opportunity needs an active program, an actually open round, valid entry-window dates and a primary-supported, current round-specific access assessment. The assessment must establish an available route, access for new applicants and clear prerequisites. Announced/future rounds, closed prerequisite stages, invitation/internal-selection routes, stale access checks, exact expired cutoffs and ambiguous date precision are excluded. This does not personalize eligibility. Review expiry removes an actionable claim, not the public program or its history.

No old record is automatically declared newly verified. Empty opportunities can mean missing access assessments. Coverage is included in the index.

## Migration pilot

```sh
npm run validate
node scripts/stage-funding-import.mjs --pack research/v2/spotify-pilot.json
node scripts/stage-funding-import.mjs --pack research/v2/spotify-pilot.json --write-stage /tmp/grants-v2-preview
node scripts/validate-registry-v2.mjs --root /tmp/grants-v2-preview/registry
```

The default is a read-only plan. `--write-stage` creates a NEW external directory containing a complete staging registry and report. No `--apply`, live write, database connection or merge occurs. Source blob guards, append-only keys, whole-snapshot validation, drift detection, symlink rejection and atomic publication protect the staging operation. A repeat pack is a no-op; changed content under the same key requires explicit supersession. Existing output directories are never overwritten.

The pilot contains one historical Spotify terms record and three 2025 cohort awards announced in January 2026. EUR values stay exact; award/payment dates stay unknown. The candidate is outside canonical ledgers. It is not live data until separately reviewed and integrated.

Source: https://engineering.atspotify.com/2026/1/congratulations-to-the-recipients-of-the-2025-spotify-foss-fund

## Tests and remaining scope

Dependency-free tests cover schemas, private fields, dates, opportunity access, cursors, failures and staging. CI additionally exercises YAML parsing, the full existing registry, the real pilot, repeat imports, exact v1 byte compatibility and the existing application gates. Run `npm test`, `npm run typecheck`, `npm run build` and browser tests before release. Tests requiring TEST_DATABASE_URL must be reported as skipped when no test database exists.

Not yet implemented: bulk research backfill, source-specific scheduled adapters, all 47 research controls, complete field-level provenance/rights registry, public historical changes feed, outputs/impact joins, quota/billing systems, new Desk mutation paths for v2 sidecars, production rollout. Reference-changing Desk edits will fail v2 validation until sidecars are reconciled. Keep the preview disabled in production until that integration and rollback procedure are accepted.
