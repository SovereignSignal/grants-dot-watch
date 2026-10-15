# grants.watch — Design

*Approved by Sov 2026-07-07 (brainstorm session, high-level sign-off; details to be tuned in use).*

## In one line

The canonical registry of the funding world Sov tracks — systems, organizations, programs, rounds, awards — fed by wire signals, self-curating under a two-lane gate, mirrored into Notion for CRM, built to become a public resource.

## Why

The "known world" of orgs is scattered across six places (Notion Orgs, `watch_surfaces`, `org_profiles`, funder/grantee profiles, the awards ledger, Stringer's lake) and none of them is the entity system of record. wire-room-ops is the *signal* system — it is the wrong home for entities. grants.watch gives the intelligence asset (the center of the June first-principles model) its own sovereign home, sibling to discuss.watch.

## Decisions locked (Sov, 2026-07-07)

1. **Systems = funding ecosystems**, not the wires. Test: *capital gravity* — its own treasury/foundation/allocating identity plus ≥2 orgs/programs that organize under it. Cardano passes; "Crypto" fails (it's a wire = tag/lens). Systems are flat, may link `part_of` (Optimism → Ethereum), carry `kind: protocol-ecosystem | funding-domain`. Orgs join several systems; `systems: []` is legal.
2. **One org registry, depth by role.** Everyone is an org. Funders get deep curation; grantees exist as thin records derived from awards, promoted to curated files only when they matter.
3. **Two-lane curation from day one.** Authoritative, exact deadline facts may auto-apply after the full safety gate; every identity, status, award, profile, taxonomy, and new-program judgment queues for Sov. Graduation of a judgment class requires an explicit policy change backed by verdict logs.
4. **Notion mirror: all funders.** Every funder org gets/keeps a row in "Sov's Orgs"; grantees never do. Registry pushes read-only summary fields; Notion keeps owning Relationship, Action(s), Contacts, people. One-way per field, no write-back.
5. **V1 = private asset first.** Registry + seed + signal feed + curation + site. Public launch (flipping the repo/site public) and the full galaxy viz are later phases — but the site ships polished from day one because Sov curates by using it.
6. **Hosting: Railway** (Sov). Repo: `SovereignSignal/grants-dot-watch`, private until the data earns publicness.

## Architecture (hybrid: curated core in git, operational layer in Postgres)

```
grants-dot-watch/
  registry/                  # THE CANONICAL DATASET (public-ready from day one)
    systems/<slug>.yaml      # ~10–30 funding ecosystems (the galaxies)
    orgs/<slug>.yaml         # curated org files — funders + orgs that matter
    programs/<slug>.yaml     # one file per funding vehicle; rounds inside as a list
    awards/<year>.jsonl      # append-only award facts (funder → grantee, sourced)
  app/                       # Next.js/TS service, deployed to Railway
  scripts/                   # seed/migration/QA tooling
  docs/
```

- **Files are the truth.** The app's Postgres holds only operational state: signal inbox, judgment queue (`proposals`), resolver misses, sync watermarks, derived grantee records, verdict log. Burn the DB down and the registry has lost nothing.
- **Three writers, one door:** Sov's hand edits (always win), the fact lane (bot commits, source URL in the commit message), approved judgment items (the approve action lands the commit).
- **Railway `watchPaths` = app code only** — registry commits don't redeploy; the app refreshes its index when `registry/` changes.
- **Private membrane by construction:** BD fields from `org_profiles` (`relationship_context`, `propensity_score`, `current_wedge`, `recommended_action`, `operator_read`, `watch_priority`) and anything account-scope NEVER enter registry files. They live only in the private DB world and Notion.

## File schemas

**System** (`registry/systems/<slug>.yaml`)
```yaml
id: cardano
name: Cardano
kind: protocol-ecosystem      # or funding-domain
part_of: []                   # e.g. [ethereum] for Optimism
wires: [crypto]
summary: >
  One-paragraph orientation: what the system is, how capital moves in it.
funding_channels: []          # notable treasury/program slugs
sources: []
```

**Org** (`registry/orgs/<slug>.yaml`)
```yaml
id: uniswap-foundation
name: Uniswap Foundation
aka: [UF, Uniswap Grants]     # resolver aliases
systems: [ethereum]
wires: [crypto]
roles: [funder]               # funder | grantee | both
website: https://...
socials: { x: "...", github: "...", forum: "..." }
status: active                # active | winding-down | dormant | dead
profile: >
  2–4 sentence briefing card. Public facts only.
funding: { typical_size: "...", cadence: "...", focus: [...] }
sources: [...]                # provenance URLs
```

**Program** (`registry/programs/<slug>.yaml`)
```yaml
id: uniswap-grants
name: Uniswap Grants Program
org: uniswap-foundation
parent: null                  # program slug for sub-programs
systems: [ethereum]
wires: [crypto]
status: active
mechanism: grants             # grants | retro | quadratic | prize | fellowship | incubator | rfp
apply_url: https://...
summary: >
  What it funds, for whom.
rounds:                       # dated instances: rounds, waves, cohorts, funds
  - name: "Wave 5"
    status: open              # announced | open | reviewing | closed | deployed
    opens: 2026-06-01
    closes: 2026-08-15
    size: "$1.5M"
    source: https://...
sources: [...]
```

**Award** (`registry/awards/<year>.jsonl`, append-only)
```json
{"funder":"uniswap-foundation","funder_name":"Uniswap Foundation","grantee":"gauntlet","grantee_name":"Gauntlet","amount":500000,"currency":"USD","amount_text":"$500k","date":"2026-03-12","program":"uniswap-grants","wire":"crypto","source":"https://...","key":"<dedupe>"}
```

## Signal flow

Sources (v1, all read-only pulls): the wire canonical Postgres (`scan_entries` — everything the scanning world catches funnels there) and discuss.watch `/api/v1/grants` (`since` watermark). Seed-time only: awards ledger, org/funder/grantee/program profiles, `watch_surfaces`, Notion Orgs.

Pipeline: signal → **resolver** (explicit canonical name first, then unique alias/domain; a collision is quarantined and counted as dropped) → **deterministic extraction** (`ingest.ts`, no LLM; typed changes currently limited to safe deadline candidates plus owner-reviewed new entities/programs) → **lane router**:

| Lane | Qualifies | Effect |
|---|---|---|
| Fact | current round/deadline values supported exactly by the org's own page or trusted feed | safe fetch + exact value binding + full staged-registry validation, then apply |
| Judgment | new orgs/programs, status/profile changes, awards, merges/renames, system membership | queue → admin UI → full staged validation → approve lands the commit, reject logs why |

**Machine validation, the graduation clause (2026-07-11):** Sov won't hand-approve routine items — the system checks them itself, deterministically, no LLM (`proposal-validator.ts` + `validation-runner.ts`, run via `POST /api/desk/validate` or the Desk's "Run validation" button). This turns the two lanes above into three tiers:

| Tier | What it means | Effect |
|---|---|---|
| Machine-validated | authoritative evidence safely fetches, supports the exact year-bearing change, and the complete staged registry validates | auto-applied + committed, verdict `by: machine` |
| Exception queue | a check failed | stays pending; Desk shows "machine check failed — &lt;reason&gt;" |
| Never-auto | new orgs/programs, status/profile changes, new awards, org merges | stays pending; Desk shows "needs the owner" |

**Expiry (daily Desk upkeep, `DESK_UPKEEP_ENABLED=1`, default off):** the daily ingest run rejects a pending item, verdict `by: machine`, when every live round it proposes (open, announced or undated status) closed after it was filed (`auto: expired (deadline YYYY-MM-DD passed)`), or when it has waited 30 days (`auto: stale (pending 30+ days)`). An item filed after its own deadline records history and only the 30-day rule applies to it. Funding v2 imports, org merges and claimed (`applying`) items are never expired. At most 100 a run; the rule is `expiryFor` in `src/lib/desk-upkeep.ts`.

## The app (v1 site)

Next.js/TS on Railway (discuss.watch stack). Reads `registry/` into an index at boot; Postgres for queue/state. Surfaces:

- **Browse:** systems → orgs → programs (+ rounds), awards, derived grantee pages, co-funding.
- **Search/filter:** name/alias/text; by system, wire, role, status, mechanism.
- **Galaxy overview:** systems as galaxies, orgs as stars, programs as orbits — v1 gets a polished but bounded version (the full cosmos treatment is phase 3).
- **The Desk (admin, authed):** judgment queue with rendered diffs, one-tap approve/reject from a phone; verdict log; resolver-miss triage.
- **Health:** ingest watermarks, last refresh, counts, stale applies, ready sync rows, and replay conflicts.

## Notion mirror (build in v1, first run gated)

Worker with a per-field ownership map. Registry→Notion for every funder org: summary fields (systems, live programs, next deadline, last activity, registry link). Never touches Relationship/Action(s)/Contacts/Tier. Batched writes, 429 backoff, dry-run mode; **first real run only after Sov reviews the dry-run diff** (his CRM, his call).

## Postgres layer

`registry/` files are canonical; Postgres is a disposable index plus real operational state. Four migration files live under `db/migrations/`:

- **`001_registry_index.sql`** — `registry_systems`, `registry_orgs`, `registry_programs`, `registry_rounds` (programs' `rounds[]` unnested for querying), `registry_awards`: faithful relational mirrors of the YAML/JSONL schemas (text ids as PKs, `text[]` for arrays, `jsonb` for nested shapes and the full parsed doc, plus `loaded_at` + `content_hash` per row). **INDEX tables — DROP-and-rebuild safe**, never hand-edited; a `registry_awards` row's identity is its file `key`.
- **`002_operational.sql`** — real Postgres state with no file equivalent: `org_sources` (every URL known for an org, with liveness tracking — `last_checked`/`http_status`/`dead` — seeded from the registry but never truncated, so that state survives reloads), `notion_map` (org ↔ Notion "Sov's Orgs" row for the mirror), `enrichment_runs` (a log of loader/enrichment passes). Desk tables (`desk_proposals`, `desk_verdicts`, `ingest_state`) already exist via `src/lib/desk-store.ts` and are untouched by this layer.
- **`003_desk_ledger.sql`:** the durable Desk replay ledger with complete compare-and-set snapshots.
- **`004_desk_ledger_outbox.sql`:** prepared, ready, and abandoned outbox states plus replay error telemetry. Only ready rows can sync. An approval makes its prepared rows ready in the same transaction as its verdict.

**Loader:** `node scripts/load-registry-pg.mjs [--db-url <url>]` (or `DATABASE_URL` env). It first runs the complete registry validator and a strict parser anchored to the checkout. It then applies migrations and reloads all disposable index tables in one transaction, checking every entity and round count before `COMMIT`. `--check-only` exercises the same preflight without a database. It then upserts `org_sources` without clobbering existing liveness state.

## Non-goals (v1)

Public access, the full galaxy viz, people/contacts in the registry, writes into wire-room-ops or discuss.watch, X/Telegram direct ingestion (they reach `scan_entries` already), auto-BD/Opps creation, retiring any existing table (wire-room-ops keeps `watch_surfaces` etc.; the registry becomes upstream gradually).

## Success criteria

1. A safe authoritative deadline fact lands within a day; every other change reaches Sov's review queue without data loss.
2. Sov answers a consulting question from the site faster than from the query brain.
3. Notion funder rows carry live registry summaries (post dry-run approval).
4. Zero BD-private fields in any `registry/` file (verifiable by grep/CI).
5. The registry survives a DB wipe (rebuild from files).

## Voice & era (Sov, 2026-07-11)

The register is the 1920s–30s wire service — the grand age of the newspaper — carried by
discipline, never costume. grants.watch speaks as a press bureau for capital: dispatches
from the funding wires, edition-stamped, sourced like a paper of record.

- Masthead: "■ grants.watch | THE REGISTRY OF THE FUNDING WORLD". Footer keeps the same line.
- The era lives in CONVENTIONS, not decoration: datelines ("ETHEREUM WIRE — JUL 11"),
  slug lines (small caps: NEW ORGANIZATION · CRYPTO WIRE · CONFIDENCE 85), edition stamps
  (EDITION 2026.07.11), plates and figure captions, telegraphic section labels
  (DISPATCHES, THE DESK, STANDING — NO FIXED DEADLINE).
- "Wire" is the native word for the three verticals — lean into it. "Dispatches" names
  incoming signal streams. "Ledger" only ever means the awards ledger.
- NO pastiche: no distressed textures, no faux-aged paper, no period typefaces beyond the
  serif/sans system already chosen. Modern hairline discipline, era-true voice.
- PLAIN PROSE (Sov, 2026-07-12): short sentences. No em dashes. Cut adjectives and
  filler. If a sentence sounds like AI wrote it, rewrite it. Applies to product copy,
  docs, and reports.
- NO aphorisms (Sov, 2026-07-11): display statements DESCRIBE the product or STATE fact —
  never maxims or process-philosophy ("Nothing joins the registry until someone reads it
  and says so" is the canonical counter-example: killed on sight).
- EXTERNAL READER TEST (Sov, 2026-07-11): every public page must be fully legible to a
  first-time visitor with zero context. Insider terms get an inline definition at first
  use per page or get replaced with plain words. Empty states explain what absence means.
- Icon: the ink square printer's block. Nothing cosmic, ever.
- House style (2026-10-13): palette, fonts, the rust rule and the endorsement line come from the Sovereign Signal brand repo (`SovereignSignal/sovereign-signal-brand`, see its `BRAND.md`); the site's copy of the tokens is `src/brand/tokens.css`.
