# 2026-07-10 backfill report — registry backend + Notion reconcile + enrichment sweep

Ship commit: `c960c43` ("Registry backend + Notion reconcile + enrichment sweep"), deployed to
the production grants.watch service from a clean clone of `origin/main`.

## What shipped

- **Postgres layer** (`db/migrations/001_registry_index.sql`, `002_operational.sql`): the disposable
  `registry_*` index tables, plus real operational state — `org_sources` (URL liveness), `notion_map`
  (org ↔ Notion row), `enrichment_runs` (loader/sweep log). Loaders: `scripts/load-registry-pg.mjs`
  (registry/ → index, idempotent) and `scripts/load-enrichment-pg.mjs` (source-check + Notion-map sweep
  output → operational tables, idempotent).
- **132 registry/orgs/*.yaml facts applied** — machine-verifiable corrections sourced from each org's own
  pages (new `funding.focus`/`apply_url`, corrected `website`, added `socials`, new provenance URLs
  appended to `sources`), per docs/DESIGN.md's fact lane. No editorial judgments were silently applied —
  those went to the Desk (see below).
- **185 new Desk proposals** (`seed/proposals-batch-6.json` + 12 `seed/proposals-enrich-batch-*.json`
  files) covering new orgs, new programs, status/round changes, and profile notes surfaced by the
  Notion-reconcile and enrichment sweeps.
- **Bug fix in `src/lib/desk-store.ts`**: `collectSeedProposals`'s file filter only matched
  `proposals-batch-*.json`, so the 12 `proposals-enrich-batch-*.json` files (112 of the 185 new
  proposals) would have silently never reached the Desk even though they shipped in `seed/`. Widened the
  regex to `^proposals-.*batch-\d+\.json$` (matches both) and un-ignored
  `!/seed/proposals-enrich-batch-*.json` in `.gitignore` so the files actually ride with the repo (they
  are read from disk at runtime on Railway's ephemeral filesystem, same as the original batch files).
  Verified post-deploy: the `/api/desk/seed` call imported exactly 185, skipped exactly the 169
  pre-existing rows — no proposals lost.

## Field-coverage census (registry/orgs, HEAD~1 vs HEAD, 230 orgs both sides)

| field | before | after | delta |
|---|---:|---:|---:|
| aka | 119 | 121 | +2 |
| systems | 128 | 128 | 0 |
| wires | 228 | 228 | 0 |
| roles | 230 | 230 | 0 |
| org_type | 226 | 226 | 0 |
| website | 230 | 230 | 0 |
| socials | 112 | 161 | **+49** |
| status | 230 | 230 | 0 |
| profile | 230 | 230 | 0 |
| funding | 64 | 141 | **+77** |
| sources | 230 | 230 | 0 (count-of-files; see below for URL count) |

Biggest gains: `funding` block (focus areas / apply_url) populated on **77 more orgs** (64→141, +120%),
`socials` populated on **49 more orgs** (112→161, +44%). 59 new provenance URLs were appended across
`sources:` arrays (org's-own-page fact lane, per DESIGN.md).

## Proposals by type (185 new, this sweep)

| type | count |
|---|---:|
| new_program | 88 |
| new_org | 73 |
| profile_note | 14 |
| status_change | 6 |
| round_update | 4 |
| **total** | **185** |

(Desk-wide total after import: 354 — the 169 already on the Desk from prior runs, plus these 185.)

## Dead URLs found (org_sources liveness sweep)

439 URLs checked across the enrichment sweep (`seed/source-checks.json`, merged from 12 batch files);
**47 flagged dead** (404/403/429/dns_error/timeout on the org's own site). Notable: `wellcome-trust` (3
URLs, 403 — likely bot-blocked, not actually dead), `chan-zuckerberg-initiative` (3 URLs, 404 — RFA page
structure changed), `cisco-foundation` (3 URLs, 403). Full list recorded in `org_sources.dead` /
`.http_status` in Postgres (never in registry/ files — liveness is operational state, not canonical
fact, per DESIGN.md). No registry file was auto-edited off a dead-URL finding; that would be an editorial
judgment (a status change), not a fact.

## Postgres row counts (post-load, Railway)

| table | rows |
|---|---:|
| registry_systems | 21 |
| registry_orgs | 230 |
| registry_programs | 75 |
| registry_rounds | 87 |
| registry_awards | 2,510 |
| org_sources | 888 |
| notion_map | 223 |
| enrichment_runs | 4 |
| desk_proposals | 354 |
| **total** | **4,392** |

File/db counts matched exactly on load (`load-registry-pg.mjs` exits non-zero on mismatch; it exited 0).

## Checks run before shipping

- `node scripts/validate-registry.mjs` → OK: 21 systems, 230 orgs, 75 programs validated.
- `grep -riE "relationship|propensity|wedge|warm lead|quality score" registry/` → only hit is
  `registry/SCHEMA.md`'s own rule statement ("NEVER include: relationship/CRM data, propensity or
  quality scores..."), pre-existing and unmodified — not a violation in registry data.
- `npx tsc --noEmit` → clean.
- `npx next build` → succeeded (340 static pages, one pre-existing Turbopack NFT-trace warning on
  `next.config.ts` unrelated to this change).

## Deploy

Built and deployed from a clean clone (`/tmp/gw-deploy`) reset to `github/main` at `c960c43`, via
`railway up --detach`. Deployment `b5376699` reached `SUCCESS`. `POST /api/desk/seed` (admin-token
authed) then imported the 185 new proposals into the live Desk.
