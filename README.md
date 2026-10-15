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
  and taxonomy queue at **The Desk** for the owner. The one award exception is opt-in
  (`AWARD_SOURCES_AUTO_APPLY=1`): a clean first-party award packet from the daily sweep, see
  `docs/funding-live-product.md`. The one program exception is also opt-in
  (`WIRE_PROGRAM_AUTO_APPLY=1`): a Wire new program for an org already on file, confirmed on
  that org's own site, see `docs/WIRE-HANDOFF.md`. Review renewals are the third opt-in
  (`REVIEW_RECHECK_ENABLED=1` with `DESK_UPKEEP_ENABLED=1`): a program review's two dates move
  only when a fresh fetch of its official page still names the program and supports the recorded
  intake, see `docs/DESIGN.md` "Review renewal".
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

### Database deployment

Provision or upgrade the Desk schema with `DATABASE_URL` set to a dedicated database owner connection and `node scripts/migrate-desk.mjs --apply`. Omitting `--apply` prints the plan. Production startup verifies the existing schema using SELECT only. Its runtime role needs SELECT, INSERT and UPDATE on the four Desk tables, and USAGE on the ledger ID sequence. Development keeps automatic setup against disposable databases.

### Admin authentication

The Desk has independent owner and machine access paths:

- **Privy owner access:** set `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID`,
  server-only `PRIVY_APP_SECRET`, and comma-separated `DESK_OWNERS`. Allow each deployment
  origin in the Privy app and Web client. Enable email OTP only, with CAPTCHA disabled. The
  server verifies every access token with Privy, fetches the verified email account from Privy,
  and checks `DESK_OWNERS`; client fields and OAuth accounts never grant access.
- **Machine and fallback access:** `ADMIN_TOKEN` remains valid through the `x-admin-token`
  header and the Desk's HTTP-only cookie login. If either public Privy variable is omitted, the
  admin UI uses this token flow. Production fails closed when neither path is configured. An
  unset `ADMIN_TOKEN` opens the gate only outside production for local development.

The browser integration deliberately uses `@privy-io/js-sdk-core` through a narrow auth-only
adapter. Its boundary is session initialization, email OTP, access-token refresh, and logout.
Stripe funding and onramp, OAuth, Farcaster, embedded or external wallets, Solana, signing,
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
`/admin/health`. `DESK_UPKEEP_ENABLED=1` (default off) adds Desk upkeep to that run, after
the Wire ingest and the award sweep: it re-checks pending curator X handles (see below) and
rejects pending items whose proposed deadline passed while they waited or that have waited
30 days, as `machine` verdicts with an `auto:` note. Funding imports, org merges and claimed
items are never expired. Rules: `docs/DESIGN.md` "Expiry". `REVIEW_RECHECK_ENABLED=1`
(default off, and only with `DESK_UPKEEP_ENABLED=1`) adds the review recheck right after
upkeep: it re-fetches the official page of every program review expired or due within 7 days
(at most 30 pages a run), renews `checked_on` and `review_after` (30 days on) when the page
supports the review, and queues closures, intake changes and anything it cannot vouch for at
the Desk. A failed fetch stamps nothing. The summary is `review_recheck` on the `last_run`
record and one line on `/admin/health`. Rules: `docs/DESIGN.md` "Review renewal".

## Agent and external read access

The public registry is already available through `/api/v1`. The keyed
`/api/v1/updates` feed adds reviewed, distributable Wire Room observations with
stable revisions and accepted public program links. Configure
`GRANTS_WATCH_READER_KEYS` (per-client SHA-256 hashes and UTC expiry times) to
enable it; it reuses the restricted `WIRE_DATABASE_URL` connection. It grants
no editing or publishing capability. See [read API and Grok pilot](docs/read-api.md)
for provisioning, full-scan semantics, limits and the standalone reader.

The curator write API at `/api/v1/curator` is a separate bearer-key gate for
queue, decide, and propose. A key that also has `apply_low_risk` can auto-apply
a verified organization X handle. With `DESK_UPKEEP_ENABLED=1`, the daily ingest run
re-runs that same check over pending X-handle notes filed before it existed (at most
25 a run). It reuses the Desk's approve/reject path and lands
new items in the same site-database queue (`desk_proposals` /
`desk_verdicts`). It does not write the Wire Room database. The routes stay
inert (`503`, no Desk reads or writes) until `GRANTS_WATCH_CURATOR_KEYS` is
set on this service. That variable holds hashed keys, scopes, expiry, and
revocation. It does not accept `ADMIN_TOKEN`, reader keys, or the wire-room-ops
internal API key. See [curator API](docs/curator-api.md).

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

Desk ledger commits stay eligible for boot recovery until deployment is confirmed.
After pushing and deploying the accepted commits, fetch the deployed Git revision
locally, then preview and confirm against the serving website:

```sh
node scripts/sync-desk-commits.mjs --confirm-deployment https://grants.watch --dry-run
node scripts/sync-desk-commits.mjs --confirm-deployment https://grants.watch
```

Confirmation checks the public deployment revision, Git ancestry, and each
ledger row's exact committed file contents. A local commit alone never marks
content deployed. Legacy rows without a safe base remain manual review items.

### Ledger operating rules

Learned on 2026-10-10, when the API went to 503 twice:

- **Sync before you hand-edit.** Production runs with `GRANTS_WATCH_NO_GIT=1`. Every
  approval lives in `desk_applied_changes` until it is synced and confirmed, and
  boot replay refuses a row whose file changed underneath it. That refusal takes
  `/api/v2` offline. Before editing any registry file by hand, sync, push, deploy
  and confirm, until no ready row is unsynced.
- **One sync owner.** Only one person or agent runs `sync-desk-commits.mjs` at a
  time. Since 2026-10-15 that owner is the `Desk sync` workflow
  (`.github/workflows/desk-sync.yml`), daily at 18:30 UTC and on demand from the
  Actions tab: it syncs, validates, merges into `main` with a merge commit, waits
  for the deploy and confirms. Disable it before syncing by hand. A `--from-jsonl` replay records no SHAs in the ledger, so
  `--confirm-deployment` can never mark those rows synced.
- **Merge sync PRs with a merge commit.** Squash or rebase changes the SHAs the
  ledger recorded.
- **Partial-sync recovery.** If rows were committed without SHAs, run the
  standard sync from the commit before them, merge `main` in, keep the newest
  `registry/funding-control.json`, merge, then confirm.

From a clean checkout of `main`, using the Postgres service's public URL (the
app's own `DATABASE_URL` is a private hostname):

```sh
railway run --service Postgres --environment production -- \
  sh -c 'node scripts/sync-desk-commits.mjs --repo "$PWD" --db-url "$DATABASE_PUBLIC_URL"'
```

The script runs only when invoked by its real path, so a symlinked path exits
silently. The dry run stops at the first file that two rows touch, because it
never writes the first row's change.

Running the whole suite locally, including the Postgres tests, needs a
throwaway Postgres whose major version matches production (18). The database
name must contain `test`, the socket directory path must be short, and the
matching `pg_dump` must come first on `PATH`:

```sh
TEST_DATABASE_URL=postgres://$USER@127.0.0.1:54329/gw_test PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH" TMPDIR=/private/tmp npm test
```

The existing Wire handoff also reconciles 200 records by ID on each invocation,
cycling back to the beginning after reaching the end. This catches transactions
committed behind its timestamp checkpoint, including later withdrawals. A full
cycle takes `ceil(core_wire_rows / 200)` invocations, plus a wrap invocation when
exactly divisible. It retains evidence for review and never publishes by itself.
The reviewed initial handoff checkpoint remains required; this adds no schedule.

Production Desk schema is provisioned separately from runtime access:

```sh
node scripts/migrate-desk.mjs
# With a dedicated owner DATABASE_URL, after reviewing the dry run:
node scripts/migrate-desk.mjs --apply
```

The website only verifies existing columns in production. Development and
isolated tests can provision them automatically. Create a dedicated runtime
login, grant database CONNECT, and apply `scripts/database-runtime-grants.sql`
as the owner before switching the service connection. Keep the owner credential
out of the website environment. The schema command preserves records and does
not reload the separate registry index.
