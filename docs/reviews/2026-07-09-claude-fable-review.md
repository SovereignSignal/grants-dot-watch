# grants.watch Review and Claude Fable Handoff

Date: 2026-07-09

Live site reviewed: the production grants.watch deployment.

Repo reviewed: `grants-dot-watch`

## Executive Summary

The site is already coherent as a registry product. The strongest pieces are the data model, the visual identity, the galaxy surface, the Desk gate, and the public/private data membrane. The main risks are operational: stale registry cache after Desk writes, a default production build path that hangs locally under Turbopack, missing award funder refs that create bad links and undercount stats, and a few navigation/mobile issues.

Recommended split:

1. Let Claude Fable take the small visual and UI pass.
2. Let Codex verify, run data checks, inspect live routes, and prepare tighter prompts.
3. Keep data integrity and registry mutation work in small root-cause patches with validation added first.

## Confirmed Checks

Passed:

- `npm run validate`
- `npx tsc --noEmit`
- `npx next build --webpack`
- Live route crawl across `/`, `/systems`, `/orgs`, `/programs`, `/awards`, `/galaxy`, `/desk`, `/health`, `/systems/ethereum`, `/programs/openai-people-first-ai-fund`, `/orgs/openai-foundation`
- Desktop search query for `openai`, including Enter navigation to `/orgs/openai-foundation`

Build note:

- `npm run build` currently runs `next build`, which used Turbopack and stayed silent until interrupted twice.
- `npx next build --webpack` completed successfully in about 9 seconds and generated 338 pages.

Data note:

- The built-in validator passes 21 systems, 230 orgs, and 75 programs.
- A deeper award-ref check found 315 award rows across 12 funder slugs whose `funder` value does not exist in `registry/orgs`.

## Ranked Findings

### P0: Registry Cache Can Stay Stale After Desk Writes

File: `src/lib/registry.ts`

`loadRegistry()` caches the in-memory index using only directory mtime and file count. Editing an existing YAML file or appending to an existing JSONL award file can leave the cache valid even though file contents changed.

Impact:

- Desk approvals can write registry files without the running process reflecting the update.
- `/api/search-index`, org stats, counts, health output, and route content can drift until process restart or force reload.

Recommendation:

- Replace the stamp with per-file metadata, at minimum path plus `mtimeMs` plus `size` for every registry file.
- Add an exported `invalidateRegistryCache()` and call it after `applyProposal()`.
- Keep runtime parsing tolerant, but make validation strict.

### P0: Default Production Build Hangs Under Turbopack

Files: `package.json`, `nixpacks.toml`

`npm run build` calls `next build`. With Next 16.2.10, the local default Turbopack build stayed silent in the "Creating an optimized production build ..." phase until interrupted. Webpack passed.

Impact:

- Railway deploys call `npm run build`, so the current build command can become a deploy blocker.

Recommendation:

- Change the build script to `next build --webpack`.
- Keep a later investigation item for Turbopack if needed.

### P1: Awards Can Reference Missing Funder Orgs

Files: `scripts/validate-registry.mjs`, `scripts/build-awards.mjs`, `registry/awards/*.jsonl`

The validator checks award `funder` presence, but does not check that it resolves to an org file. Current data has 315 award rows across 12 missing funder slugs.

Examples:

- `mozilla-moss-awards-mission-partners`
- `arbitrum-foundation-grants-stip-bridge`
- `mozilla-moss-awards-foundational-technology`
- `protocol-labs-research`
- `arbitrum-foundation-grants-stip-round-1`
- `coinbase-developer-platform-cdp-builder-grants`

Impact:

- Award funder links can 404.
- Org stats undercount those awards.
- Some program or round labels appear to be used as funders.

Recommendation:

- Extend validation so every award `funder` must exist in `registry/orgs`.
- Repair the 12 funder slugs with a deliberate mapping to canonical org ids or with curated org files where the funder is truly distinct.
- Stop `build-awards.mjs` from silently falling back to `slugify(a.funder_name)` without emitting a hard failure or review file.

### P1: Desk Commit Scope Is Too Broad

File: `src/lib/committer.ts`

`commitChange(files, message)` receives specific changed files, but runs `git add -A registry`.

Impact:

- Approving one Desk proposal can commit unrelated local registry changes.

Recommendation:

- Stage only the relative paths from `files`.
- Keep `.data/pending-commits.jsonl` as the fallback ledger.
- Consider validating changed registry files before recording an approval verdict.

### P1: System Detail Program Cards Are Not Links

File: `src/app/systems/[id]/page.tsx`

The Programs section renders cards without `href`. On live `/systems/ethereum`, program names appear but the section has zero program links.

Impact:

- The browse path from ecosystem to funding vehicle breaks.

Recommendation:

- Render `Card href={`/programs/${p.id}`}` for each program.

### P2: Mobile Header Overlaps Nav and Search

Files: `src/app/layout.tsx`, `src/components/search.tsx`

At 390px wide, the header keeps logo, full nav, and mobile search trigger in one row. The nav extends past the viewport inside a scrollable strip and the search icon lands over the visible nav region.

Impact:

- Mobile first impression is cramped.
- Search is physically close to nav links and visually reads as overlap.

Recommendation:

- Use a two-row mobile header: top row logo plus search, second row scrollable nav.
- Or hide lower-priority nav behind a compact menu.
- Keep desktop layout unchanged.

### P2: Homepage Deadline Text Runs Together

File: `src/app/page.tsx`

Live homepage text extraction shows `Jul 13, 20265d left`.

Impact:

- Deadline cards look less polished and screen-reader text is cramped.

Recommendation:

- Render with a visible separator: `Jul 13, 2026 · 5d left`.
- On narrow cards, allow `5d left` to wrap to its own line.

### P3: Search Has Duplicate Accessible Label

File: `src/components/search.tsx`

The mobile search button and the input both use `aria-label="Search the register"`.

Impact:

- Search still works, but automated and assistive targeting finds two controls by the same label.

Recommendation:

- Label the mobile trigger `Open search`.
- Keep the input label as `Search the register`.

### P3: Homepage Latest Awards Are Less Explorable Than Awards Page

File: `src/app/page.tsx`

Homepage award rows link funders, but not grantees or programs. The Awards page links grantees and sources.

Impact:

- The homepage ledger preview feels less useful than the full ledger.

Recommendation:

- Link grantees from the homepage row.
- Link program names if the row has a valid `program` id.

## What Is Strong

- The repo has a clear source-of-truth model: `registry/` as canonical files, app index as disposable.
- The public/private membrane is explicit in docs and enforced by validation vocabulary checks.
- Desk auth fails closed in production when `ADMIN_TOKEN` is missing.
- The galaxy surface has reduced-motion handling, deterministic layout, live filters, focus links, and a screen-reader fallback to `/orgs`.
- The site has a strong visual identity and does not feel like a generic dashboard.
- Search is small, fast, lazy-loaded, and works on desktop.
- The schema docs and design docs are aligned with the implementation.

## Collaboration Model With Claude Fable

Use Fable for:

- Visual layout fixes.
- Copy and interaction polish.
- Small product passes that need taste and screenshot comparison.
- Focused implementation tasks with clear acceptance checks.

Use Codex for:

- Repo review.
- Data integrity checks.
- Validator/test work.
- Build and deploy diagnostics.
- Live route crawls.
- Final verification.

Working pattern:

1. Codex writes a tight prompt with context, files, constraints, and verification.
2. Fable makes the patch.
3. Codex reviews the diff against the prompt, runs checks, and crawls the live/local pages.
4. Codex sends the next patch prompt or closes the loop.

Keep Fable tasks small. One visual pass, one data pass, one operational pass.

## First Prompt For Claude Fable

```text
You are working on grants-dot-watch, a Next 16 app where registry files are the source of truth.

Do one small root-cause pass. Do not push or deploy.

Fix these four issues:
1. Pin the production build to webpack because local `next build` hangs under Turbopack, while `next build --webpack` passes.
2. Make system detail program cards link to `/programs/[id]`.
3. Fix the mobile header so nav and search do not overlap at 390px width. Keep the current visual language.
4. Fix homepage deadline spacing so it reads like `Jul 13, 2026 · 5d left` or equivalent with clear separation.

Constraints:
- Keep the diff small.
- Do not add a new design system.
- Preserve the dark observatory visual direction.
- Do not touch registry data in this pass.

Verify:
- `npm run validate`
- `npx tsc --noEmit`
- `npm run build`
- Manual mobile check at 390px wide for `/`, `/orgs`, `/programs`, `/awards`, `/galaxy`
```

## Second Prompt For Claude Fable

```text
You are working on grants-dot-watch.

Focus only on registry integrity around award funders. Do not change visuals.

Problem:
The current validator passes, but 315 award rows across 12 funder slugs reference funders that do not exist in `registry/orgs`. This creates 404 funder links and undercounted org stats.

Tasks:
1. Add validator coverage so every award `funder` must exist in `registry/orgs`.
2. Add validator coverage so duplicate award keys are detected across all award files, not just inside one year file.
3. Repair the current missing funder refs with a deliberate mapping to canonical org ids where obvious.
4. For non-obvious funder refs, produce a small markdown note listing the unresolved cases and proposed owner decision.

Known missing slugs include:
- `mozilla-moss-awards-mission-partners`
- `arbitrum-foundation-grants-stip-bridge`
- `mozilla-moss-awards-foundational-technology`
- `protocol-labs-research`
- `arbitrum-foundation-grants-stip-round-1`
- `coinbase-developer-platform-cdp-builder-grants`

Constraints:
- Do not invent org facts.
- Preserve award provenance URLs.
- Keep changes deterministic.
- If a funder slug is really a program or round, map the award funder to the parent org and preserve the program or round name in `program_name`.

Verify:
- `npm run validate`
- A script or one-liner showing zero awards with missing funder orgs
- `npx tsc --noEmit`
- `npm run build`
```

## Third Prompt For Claude Fable

```text
You are working on grants-dot-watch.

Focus only on registry cache freshness and Desk write behavior. Do not change visuals or registry data.

Problems:
1. `loadRegistry()` uses directory mtime plus file count as its cache stamp, so editing an existing file can leave cached registry data stale.
2. `commitChange(files, message)` receives changed file paths but stages all of `registry/`.

Tasks:
1. Update the registry cache stamp to include every registry file path plus `mtimeMs` plus `size`.
2. Add an explicit `invalidateRegistryCache()` export.
3. Call cache invalidation after Desk proposal application succeeds.
4. Scope git staging to the files passed into `commitChange`.

Constraints:
- Keep runtime behavior tolerant of malformed registry files.
- Keep validation as the strict quality gate.
- Do not change proposal schemas.
- Do not commit or push.

Verify:
- `npm run validate`
- `npx tsc --noEmit`
- `npm run build`
- A small local check showing an existing registry file edit changes the registry stamp or invalidates the cache
```

## Open Product Choices

- Should the public launch branch remove or reword private repo/hosting references in `docs/DESIGN.md`?
- Should `/health` be public long term, or should it become admin-only once the Desk has real operational state?
- Should the galaxy represent multi-system orgs as links across systems, or keep the simpler primary-system placement?
- Should homepage award rows link grantees and programs, or stay funder-first?

## Recommended Near-Term Order

1. Fable UI/build quick pass.
2. Codex verification pass.
3. Award funder integrity pass.
4. Registry cache and Desk staging pass.
5. Public launch membrane pass.
