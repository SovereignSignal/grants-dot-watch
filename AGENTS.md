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
  `npm run validate`, `npm run check:loader`, `npm run check:public`, `npm run test:browser`
  (needs Chromium via `npx playwright install --with-deps chromium`).
- **Recency law:** a round whose `closes` date is already past must not stay `open` or
  `announced` — set it to `closed` (the committer auto-closes on write; `npm run validate`
  fails the registry otherwise). Prefer closing stale rounds over weakening the validator.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
