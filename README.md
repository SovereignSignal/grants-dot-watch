# grants.watch

**The registry of the funding world.** Systems, organizations, programs, rounds, and awards
across crypto, AI, and open source — as plain files, curated under an owner's gate,
served as a site.

Part of the [.watch](https://discuss.watch) family · a [Sovereign Signal](https://sovereignsignal.substack.com/) instrument.

## How it's built

- **`registry/` is the truth.** Systems, orgs, and programs are YAML; awards are append-only
  JSONL. Every fact carries provenance. The app's database is disposable — burn it down and
  the registry has lost nothing. See `registry/SCHEMA.md`.
- **Two-lane curation.** Machine-verifiable facts (round dates, award records, dead links)
  auto-apply as commits with the source in the commit message — undo is `git revert`.
  Editorial judgments (new orgs, merges, taxonomy) queue at **The Desk** for the owner.
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
npm run build && npm run start
```

Environment (all optional in dev): `ADMIN_TOKEN` gates The Desk; `GRANTS_WATCH_NO_GIT=1`
disables commit-on-approve (decisions ledger to `.data/pending-commits.jsonl` instead).

## Layout

```
registry/          the canonical dataset (systems/ orgs/ programs/ awards/ SCHEMA.md)
src/               the Next.js app (site + The Desk + API)
scripts/           seed, resolve, validate, ingest tooling
docs/DESIGN.md     the system's law
seed/              working data for seeding (gitignored)
```
