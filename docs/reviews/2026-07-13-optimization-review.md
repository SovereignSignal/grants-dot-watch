# grants.watch Optimization Review

Date: 2026-07-13 PDT

Scope: current `main` at `e236f55`, the deployed site, registry integrity, the ingest and Desk paths, build behavior, responsive rendering, accessibility, and launch readiness.

## Executive View

The product has a clear identity and a useful core model. The strongest parts remain the file-backed registry, source links, restrained visual system, server-rendered browse surfaces, and owner-gated Desk.

The main risk has moved. The first audit found missing reference checks and unsafe cache and commit behavior. Those issues are fixed. The current risk is uncontrolled entity creation. The registry grew from 75 programs on July 10 to 705 committed programs on July 13. The ingest mapper can turn almost any resolved signal title into a new program, and the validator proves that the page and org exist without proving that the candidate is a funding vehicle. That is creating false programs faster than later dedup passes can repair them.

Recommended order:

1. Pause machine approval for `new_program` until the classifier and duplicate gate are tightened.
2. Make every public registry surface read one current registry snapshot.
3. Make Desk application idempotent before any file write.
4. Repair the cadence view and then clean the existing program set.
5. Pin the passing build path and add a small regression suite.

## Confirmed Checks

Passed:

- `npm run validate`
- `npx tsc --noEmit`
- `npx next build --webpack`
- Representative live routes for home, systems, organizations, programs, detail pages, redirects, and the gated Desk
- Live browser console check with no warnings or errors

Build findings:

- `npm run build` invokes the default Turbopack build and made no progress after 60 seconds at `Creating an optimized production build`.
- The webpack build completed and generated 1,142 pages.
- The webpack build emitted unresolved optional-module warnings from `@privy-io/react-auth` for `@stripe/crypto` and `@farcaster/mini-app-solana`.
- The build report confirms that `/`, `/systems`, and every system, org, and program detail page are prerendered. `/programs`, `/orgs`, and `/api/search-index` are dynamic.

Current committed registry census:

| Measure | Count |
|---|---:|
| Systems | 21 |
| Organizations | 405 |
| Programs | 705 |
| Awards | 2,510 |
| Rounds | 315 |
| Programs with `status: unknown` | 430 |
| Programs with no rounds | 465 |
| Programs with no mechanism | 408 |
| Programs with no system | 569 |
| Open or announced rounds already past due | 4 |
| Concluded programs with a live round | 1 |

Live rendering measurements:

- The static homepage showed 705 programs and a July 12 registry edition.
- The dynamic programs page showed 708 programs and a July 14 UTC registry edition during the same review session.
- The cadence response was about 1.29 MB uncompressed.
- At 390 px wide, cadence rendered 710 main links, a 36,714 px document, and a 551 px layout width. Month labels and captions overlapped.
- The mobile sticky header was about 204 px tall. Only the first two nav items were visible without horizontal scrolling.

## Ranked Findings

### P0: Public Pages Read Different Registry Snapshots

Files:

- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/systems/page.tsx`
- `src/app/systems/[id]/page.tsx`
- `src/app/orgs/[id]/page.tsx`
- `src/app/programs/[id]/page.tsx`
- `src/lib/registry.ts`

The build prerenders the homepage, systems list, and all detail pages. The organization and program indexes are dynamic. Desk writes invalidate the in-process registry cache, but invalidation cannot update HTML that was emitted during the last build.

This is visible in production. The homepage and programs page reported different program counts and edition dates in the same session. The homepage also kept showing July 12 deadlines after they had passed.

`loadedAt` adds a second problem. It is set to the moment `loadRegistry()` rebuilds its in-memory index. The public masthead presents it as the registry's data date. A request that reloads the cache can therefore make the registry look freshly updated even when no source file changed.

Recommendation:

- Make public registry pages dynamic as one unit. A public route-group layout with `dynamic = 'force-dynamic'` is the clearest contract.
- Remove or stop relying on `generateStaticParams()` for registry detail freshness.
- Add `updatedAt` derived from registry file metadata or the latest durable applied-change record. Keep `loadedAt` on the private health page only.
- Add a route-level smoke test that writes a temporary registry fixture, invalidates the cache, and verifies home, index, search, and detail views agree.

Acceptance checks:

- Home, programs, systems, search, and an existing detail route report the same count after one approved change.
- A past deadline disappears without a deployment.
- The public edition changes only when registry data changes.

### P0: The Ingest Gate Confuses Signals With Programs

Files:

- `src/lib/ingest.ts`
- `src/lib/proposal-validator.ts`
- `src/lib/validation-runner.ts`

For a resolved org, `decide()` treats any unmatched title of three or more characters as a `new_program`. A wire row's `name` is used as the program name even when it is a news headline, report, result, award, budget proposal, or status update.

The resulting registry contains examples such as annual reports, impact reports, grant-result announcements, funding commitments, and individual award stories modeled as programs. The current name cleanup removed exact and obvious duplicates, but the creation rule remains open.

There are three related defects:

- `validateNewProgram()` confirms that the name appears on a live page and that the page is associated with the org. It does not prove that the candidate accepts applications, allocates capital, or represents a stable funding vehicle.
- Duplicate detection checks only whether the exact file slug already exists. Reworded names and multiple pages for the same program pass.
- Wire ingest assigns the org website to `apply_url`. An org homepage is not an application URL.

The mapper also creates a round named `Rolling` when it has a fixed closing date. That label is self-contradictory and appears on the public site.

Recommendation:

- Mark `new_program` as never-auto immediately. Resume machine approval after the new gate has fixture coverage.
- Require exactly one program entry per proposal or validate every entry independently.
- Require a strong vehicle signal: an explicit upstream `program` field, a real application URL, a deadline tied to an application call, a known mechanism, or equivalent structured evidence.
- Use source classification and tags. Drop reports, results, awards, budget votes, hiring posts, announcements with no application path, and broad news updates.
- Compare candidates against existing programs by normalized name, source URL, application URL, and org. Route close matches to a merge or round-update proposal.
- Stop copying `org_website` into `apply_url`.
- Use `Current call` for a fixed dated round when the source provides no round name. Reserve `Rolling` for verified no-deadline intake.

Existing data needs a cleanup queue after the gate closes. Start with unknown programs that have no rounds, no mechanism, and names containing report, results, roundup, announcement, funding commitment, or grant award language.

### P0: Desk Writes Happen Before a Proposal Is Claimed

Files:

- `src/app/api/desk/decide/route.ts`
- `src/app/api/desk/decide-bulk/route.ts`
- `src/lib/validation-runner.ts`
- `src/lib/desk-store.ts`

Single approval, bulk approval, and machine validation all mutate registry files before `recordVerdict()` acquires a row lock. Two requests can read the same pending proposal, both apply it, and only then discover that one verdict lost the race.

For append operations, this can duplicate an award line. For file updates, a later write can overwrite another proposal's change. A failed verdict can leave a changed file attached to a still-pending proposal, so retrying applies it again.

`setProposalValidationPg()` has a related race. It reads the full proposal JSON and later overwrites it without checking `state = 'pending'`. A validation result can restore stale pending data after an approval updated the same row.

Recommendation:

- Add an atomic claim step before mutation, such as `pending -> applying`, guarded by `UPDATE ... WHERE state = 'pending' RETURNING ...`.
- Give each applied proposal an idempotency key in the durable changes ledger.
- Complete the verdict from `applying`, or move the proposal to a visible recovery state on failure.
- Update validation JSON with a conditional JSONB update that only touches pending rows.
- Add concurrency tests for two manual approvals, manual versus machine approval, and bulk proposals touching the same file.

### P1: Cadence States Facts the Registry Does Not Know

Files:

- `src/components/programs/cadence-chart.tsx`
- `src/app/programs/page.tsx`

The cadence view renders every program by default. When a program has no date in the current year, it labels the lane `rolling, by engagement`. A missing date, a historical date, and verified rolling intake are different states. The current view collapses them into one positive claim.

With 705 committed programs, the view is also too large to operate as one server-rendered chart. Mobile output is wider than the viewport, captions overlap, and the page is more than 36,000 px tall.

Recommendation:

- Distinguish `verified rolling`, `no current-year dates`, and `historical only`.
- Only show a rolling lane for an open or announced round with no close date, or another explicit rolling field.
- Default cadence to programs with a current-year round. Add `Include undated` as an explicit control.
- Paginate or group-collapse large result sets.
- Give the chart a stable minimum canvas width inside an intentional horizontal scroller on small screens.
- Add a compact mobile list view. Keep the plotted chart for tablet and desktop.

### P1: The Default Deployment Build Still Uses the Failing Path

Files:

- `package.json`
- `nixpacks.toml`

Railway calls `npm run build`, which still runs `next build`. The default Turbopack build stalled in both reviews. Webpack completes.

Recommendation:

- Set `build` to `next build --webpack` now.
- Add a separate `build:turbopack` command for later investigation.
- Resolve or explicitly document the two Privy optional-module warnings so a new warning is visible.

### P1: Registry Validation Is Too Shallow for the New Scale

File: `scripts/validate-registry.mjs`

The validator now catches missing award funders and duplicate award keys across files. It still omits several relationships that are already used by the UI:

- Program wires are not checked.
- Program `apply_url` and `sources` URLs are not checked.
- Round date shape, date order, and past-due open status are not checked.
- Award `program`, wire, source URL, date, amount, and year-file consistency are not checked.
- System `funding_channels` and source URLs are not checked.
- Duplicate IDs, parent cycles, normalized same-org program names, and malformed names are not checked.
- The proposal validator's org status set omits the valid `dead` status.

Recommendation:

- Move schema rules into shared validation code used by the CLI and Desk dry run.
- Add a strict `validate:registry` command and a separate audit command for softer warnings.
- Fail hard on broken references and invalid dates. Emit review warnings for likely duplicates and semantic anomalies.
- Add the current four expired live rounds and the concluded program with a live round as regression fixtures.

### P1: Public-Ready Boundaries Contain Internal Details

Files:

- `scripts/notion-mirror.mjs`
- `scripts/sync-desk-commits.mjs`
- `src/app/api/desk/decide-bulk/route.ts`
- `src/lib/ingest.ts`

The repo is described as public-ready, but tracked code contains a personal absolute path to a token file, a private database identifier, deployment host details, and a fixed Claude session URL added to commits.

Recommendation:

- Require `NOTION_TOKEN`, `NOTION_ORGS_DB`, and `GRANTS_WATCH_PUBLIC_URL` through environment variables.
- Remove the personal token-file fallback.
- Remove fixed Claude session trailers. Optional attribution should be supplied at runtime and should never contain a private session URL.
- Run a public-boundary scan in CI for absolute home paths, secrets, internal hosts, and session URLs.

### P1: There Is No Regression Test or CI Gate

File: `package.json`

`npm test` exits with `Error: no test specified`. No tracked CI workflow runs validation, TypeScript, or the passing production build. The highest-risk code is pure enough to test cheaply: proposal mapping, duplicate detection, round merging, registry validation, and approval state transitions.

Recommendation:

- Add focused unit tests for ingest decisions, validator entry cardinality, round recency, and program duplicate matching.
- Add integration tests for cache invalidation and approval idempotency.
- Add a small browser smoke set for home, programs, search, one detail route, and 390 px layout.
- Gate changes on registry validation, TypeScript, tests, and the webpack build.

### P2: Mobile Navigation Is Still Too Large and Partly Hidden

Files:

- `src/app/layout.tsx`
- `src/components/search.tsx`

The overlap from the first review is fixed. At 390 px, the sticky header is still about 204 px tall and the nav silently clips after the first two items. Horizontal scrolling is possible but has no visible affordance.

Recommendation:

- Make the full metadata strip non-sticky on small screens, or collapse it to one short line.
- Keep logo, search, and theme on the first row.
- Put all public nav items in a visible second row or a compact menu.
- Keep The Desk out of the primary public nav unless owner access is a public product feature.

### P2: Browse and Discovery Need a Second Scale Pass

Files:

- `src/app/orgs/page.tsx`
- `src/components/search.tsx`
- `src/app/layout.tsx`

The organizations table caps output at 200 and asks users to refine filters. It has no pagination. The status filter also omits `dead`, although the schema and UI labels support it.

Search works, but its combobox does not expose an active descendant to assistive technology. The public site also has generic metadata only, with no sitemap, canonical URL policy, or social previews.

Recommendation:

- Add URL-driven pagination to organizations and a visible total/page position.
- Include `dead` in status filtering.
- Add `aria-activedescendant` and stable option IDs to search.
- Before public launch, add `metadataBase`, canonical URLs, Open Graph metadata, `robots`, and a generated sitemap.

### P3: Dependency Weight Exceeds the Current Product Surface

File: `package.json`

The current source does not import `three`, `3d-force-graph`, `three-spritetext`, or the direct Solana packages. The galaxy route has been removed, but its dependencies remain. Local `node_modules` is about 1.5 GB, with most weight coming from wallet and Web3 dependency trees.

Recommendation:

- Remove unused 3D packages and types.
- Verify whether direct Solana dependencies are still required by the configured Privy flow. Remove direct declarations that are only transitive or unused.
- Measure the admin bundle separately. Privy is route-scoped, so optimize deploy size before considering an auth rewrite.

## What Is Working

- The prior cache-stamp defect is fixed with per-file metadata and explicit invalidation.
- Desk git staging is scoped to named files.
- Award funders and cross-file award keys are validated.
- Program cards on system pages link correctly.
- Mobile search has a distinct accessible label.
- The site has a coherent visual language across home, lists, detail pages, and the Desk gate.
- Public route checks produced no browser console errors.
- Server-rendered filter links keep browse state shareable and usable without client JavaScript.

## Delivery Plan

### Batch 1: Stop Bad Writes

```text
You are working on grants-dot-watch, a Next.js registry app. Registry files are canonical and Desk proposals can mutate them.

Do not push, deploy, send messages, or write to production.

Goal: stop false program creation and make proposal application idempotent.

Tasks:
1. Make new_program a never-auto proposal class for now. It must remain visible in the Desk for owner review.
2. In the ingest mapper, stop assigning org_website to a program apply_url.
3. Never name a fixed-deadline round Rolling. Use Current call when no sourced round name exists.
4. Reject or queue proposals containing more than one new org or new program entry unless every entry is independently validated.
5. Add an atomic pending-to-applying claim before any registry file write. Manual, bulk, and machine paths must use it.
6. Make validation updates conditional on state = pending so they cannot overwrite a decided proposal.

Add focused tests for:
- a report headline from a known org does not auto-create a program
- a fixed deadline does not create a Rolling round
- two concurrent approvals apply one proposal once
- validation racing approval cannot restore stale pending data

Keep the diff scoped. Preserve the file-backed registry and durable applied-changes ledger.

Verify:
- npm run validate
- npx tsc --noEmit
- the new tests
- npx next build --webpack
```

### Batch 2: One Current Public Snapshot

```text
You are working on grants-dot-watch.

Do not push or deploy.

Goal: every public route must reflect the same current registry state after a Desk write.

Tasks:
1. Make the public registry route group dynamic. Home, systems, orgs, programs, search, and all detail pages must read the same in-process registry snapshot.
2. Stop using registry loadedAt as the public data date. Add registry updatedAt based on source-file metadata or the latest durable applied change. Keep loadedAt on the private health page.
3. Add a short stamp-check throttle so repeated loadRegistry calls inside one request do not stat every registry file. Explicit invalidation after writes must remain immediate.
4. Add fixture coverage showing that an update to an existing file changes home, list, search, and detail output without a rebuild.
5. Pin npm run build to next build --webpack.

Acceptance checks:
- build output no longer prerenders registry detail pages
- one fixture update produces the same counts and edition across public routes
- past deadlines disappear on the next request
- npm run validate
- npx tsc --noEmit
- npm test
- npm run build
```

### Batch 3: Cadence and Mobile

```text
You are working on grants-dot-watch after the registry freshness and write-safety fixes have landed.

Do not push or deploy.

Goal: make Programs useful at 705 or more records on desktop and mobile.

Tasks:
1. In cadence, distinguish verified rolling intake from no current-year dates and historical-only dates.
2. Default cadence to programs with a current-year round. Add an explicit Include undated control.
3. Paginate or collapse large cadence groups.
4. Build a compact mobile cadence list. Keep the plotted year view for tablet and desktop.
5. Reduce the mobile sticky header height and expose all public nav items without a hidden horizontal strip.
6. Add 390x844 and 1440x900 screenshot checks.

Acceptance checks:
- no horizontal document overflow at 390 px
- month labels and captions do not overlap
- no undated program is labeled rolling without explicit evidence
- the default cadence response is under 250 KB uncompressed
- keyboard search and filters still work
- npm run validate
- npx tsc --noEmit
- npm test
- npm run build
```

## Codex and Claude Fable Split

Use Claude Fable for the three bounded implementation batches above, one at a time. Use Codex after each batch to review the diff, run the data census, verify route generation, test concurrency assumptions, and inspect desktop and mobile output. Do not combine the data gate, consistency model, and cadence redesign into one patch.
