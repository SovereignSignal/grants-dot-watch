# grants.watch

**The registry of the funding world.** Systems, organizations, programs, rounds, and awards
across crypto, AI, and open source — as plain files, curated under an owner's gate,
served as a site.

Part of the [.watch](https://discuss.watch) family · a [Sovereign Signal](https://sovereignsignal.substack.com/) instrument.

## How it's built

- **`registry/` is the truth.** Systems, orgs, and programs are YAML; awards are append-only
  JSONL. Every fact carries provenance. The app's database is disposable — burn it down and
  the registry has lost nothing. See `registry/SCHEMA.md`.
- **Two-lane curation.** Exact current round and deadline facts can auto-apply only when an
  organization-owned source supports the full changed value and the staged registry passes its
  complete validation gate. New entities and programs, status/profile changes, awards, merges,
  and taxonomy always queue at **The Desk** for the owner.
- **Signals in, registry out.** Wire scanning systems feed candidate changes; nothing enters
  the registry without either machine-verifiable provenance or an owner verdict.
- **The taxonomy:** a *system* is a funding ecosystem with its own capital gravity (a treasury,
  a foundation, an allocating identity) — Cardano is a system; "crypto" is a wire (a lens).
  Orgs join systems; programs belong to orgs; rounds live inside programs; awards connect
  funders to grantees.

## Running it

```bash
npm install
npm run dev        # site on :3000, reads registry/ directly
npm run validate   # schema + membrane checks over registry/
npm run lint       # Next.js + TypeScript lint gate
npm run check:loader # strict, cwd-independent loader preflight
npm run build && npm run start
npm run test:browser # production-route Chromium smoke suite; build first
```

`GRANTS_WATCH_NO_GIT=1` disables commit-on-approve and requires `DATABASE_URL`. The no-git
approval path writes a non-replayable prepared snapshot to Postgres before touching the
ephemeral filesystem. That snapshot becomes replayable in the same transaction as the approved
verdict. Failed writes are abandoned. Local git failures use `.data/pending-commits.jsonl` on
the persistent checkout.

### Admin authentication

The Desk has independent owner and machine access paths:

- **Privy owner access:** set `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID`,
  server-only `PRIVY_APP_SECRET`, and comma-separated `DESK_OWNERS`. Register each deployment
  origin in Privy with the exact callback path `/admin/auth/callback`, for example
  `https://<deployment-origin>/admin/auth/callback`. Local OAuth uses
  `http://localhost:3000/admin/auth/callback`. The server verifies every access token with
  Privy, fetches the verified email from Privy, and checks `DESK_OWNERS`; client fields never
  grant access.
- **Machine and fallback access:** `ADMIN_TOKEN` remains valid through the `x-admin-token`
  header and the Desk's HTTP-only cookie login. If either public Privy variable is omitted, the
  admin UI uses this token flow. Production fails closed when neither path is configured. An
  unset `ADMIN_TOKEN` opens the gate only outside production for local development.

The browser integration deliberately uses `@privy-io/js-sdk-core` through a narrow auth-only
adapter. Its boundary is session initialization, email OTP, Google OAuth, access-token refresh,
and logout. Stripe funding and onramp, Farcaster, embedded or external wallets, Solana, signing,
and transaction APIs are disabled and their optional packages are not installed. Enabling any
of those capabilities requires a separate security review. Privy describes Core as a low-level
SDK; confirm this production use with Privy before enabling both public IDs in a deployment.

**Daily ingest loop** (`src/lib/ingest.ts`, `POST /api/ingest/run`, same auth as The Desk):
`WIRE_DATABASE_URL` — read-only Postgres URL for the wire-room-ops canonical database
(`scan_entries` + `org_profiles`); unset skips that source (fail-soft, logged as a source
error, never blocks discuss.watch). `DISCUSS_WATCH_GRANTS_URL` — the discuss.watch grants
feed endpoint, no API key needed; defaults to `https://www.discuss.watch/api/v1/grants`
(**not** the bare `https://discuss.watch/...` apex — that 302s through Squarespace to the
marketing homepage and drops the path). `INGEST_ENABLED=1` starts a daily in-process timer
(`src/instrumentation.ts`, nodejs runtime) guarded by a Postgres advisory lock so multiple
Railway replicas never double-run; last-run status lands in `ingest_state` and shows on
`/admin/health`.

## Release

Production tracks the `main` branch of `SovereignSignal/grants-dot-watch` through Railway's
GitHub source integration. CI must pass before merge or push. Railway then builds with the
checked-in `railway.json` and `nixpacks.toml` contract and verifies the `/` health check.

The admin browser bundle uses Privy's Core SDK only for authentication. Privy's React wallet
and onramp stack, plus its Stripe and Farcaster optional peers, stay outside the dependency and
build surface. Keep that boundary narrow; review any supported SDK upgrade or expanded Privy
capability separately.

## Layout

```
registry/          the canonical dataset (systems/ orgs/ programs/ awards/ SCHEMA.md)
src/               the Next.js app (site + The Desk + API)
scripts/           seed, resolve, validate, ingest tooling
docs/DESIGN.md     the system's law
seed/              working data for seeding (gitignored)
```
