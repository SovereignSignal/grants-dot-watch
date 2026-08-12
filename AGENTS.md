# AGENTS.md

## Cursor Cloud specific instructions

grants.watch is a **single Next.js 16 app** (App Router, React 19, Tailwind 4, TypeScript,
npm). The canonical dataset lives as plain files under `registry/` (YAML + JSONL); the app
reads those files at runtime, so the public site, search, and browse surfaces all work with
**no database and no external services**. Standard scripts live in `package.json`; the README
covers the product model.

- **Node 22** is required (`engines` allows `^20.9 || >=22`). The cloud VM already has Node 22
  and npm; the update script runs `npm ci`.
- **Run it:** `npm run dev` (Turbopack, http://localhost:3000). For admin/Desk access in dev,
  set `ADMIN_TOKEN=<something>`; when `ADMIN_TOKEN` is unset outside production the admin gate
  opens automatically. All optional backends (Postgres `DATABASE_URL`, Privy, `WIRE_DATABASE_URL`,
  Notion) are **not needed** for local dev — the Desk falls back to local JSON under `.data/`.
- **Build/prod:** `npm run build` then `npm start`. `npm run test:browser` builds are separate —
  Playwright starts its own `npm start -- --port 3100` with a test `ADMIN_TOKEN`, so don't have a
  server already bound to 3100.
- **Quality gates:** `npm run lint`, `npm run typecheck`, `npm test` (Node built-in test runner),
  `npm run check:public`, `npm run test:browser` (needs Chromium via
  `npx playwright install --with-deps chromium`).

### Known time-sensitive failures (NOT environment problems)

`npm run validate`, `npm run check:loader` (which invokes validate), and one unit test in
`tests/proposal-validator-safety.test.mjs` ("staged registry validation catches schema and
reference violations before write") fail **only because the registry data is time-sensitive**.
Many `registry/programs/*.yaml` rounds have `close` dates in mid-2026; once the system clock is
past those dates, the validator reports them as `round "..." is open with past close <date>`.
This flood of expected-past-close errors is what breaks `validate` and drowns out the injected
error the unit test greps for. These failures reflect stale round data relative to the current
date, not a broken setup — do not "fix" them by editing the environment. `lint`, `typecheck`,
`build`, the other 60 unit tests, and all 10 Playwright browser tests pass cleanly.
