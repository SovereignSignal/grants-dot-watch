# Curator API

Hedwig, or any other agent acting for Sov, can read the Desk queues, decide
items, and propose changes without the Privy-gated `/admin/desk` UI. Approve
and reject call the same `decideProposal` path as the Desk buttons, including
the registry write and the `GRANTS_WATCH_NO_GIT` ledger. Proposals go through
`insertIngestProposals`, the same queue insert as wire ingest, and show up on
the Desk for Sov to approve.

This API cannot delete registry files, merge organizations, bulk-decide, or
change `ADMIN_TOKEN`, reader keys, or `DESK_OWNERS`. It does not accept
`ADMIN_TOKEN`, reader keys, or the wire-room-ops `INTERNAL_API_KEY`.

## Where writes land

Judgment, Facts, and the Desk Log live on the site database (`DATABASE_URL`):
`desk_proposals` and `desk_verdicts`. That is the grants-dot-watch Postgres,
not the Wire Room database. Wire Room tables such as `review_queue` and
`publication_queue` are not the Desk queues, and this API does not write them.
This app only reads `WIRE_DATABASE_URL` (`scan_entries` and `org_profiles`) for
ingest and the public updates feed.

A curator proposal stores `submitted_by` (key id, name, reason, sources,
quotes, time) on the proposal JSON. A curator decision stores the same identity
on the verdict JSON. The Desk Log reads those fields and labels the row
`curator · <name>`. No new table, so the Desk migration is unchanged.
Idempotency uses the existing `ingest_state` table when `DATABASE_URL` is set.

## Keys

`GRANTS_WATCH_CURATOR_KEYS` is a JSON array. Each entry has `id`, `name`,
lowercase SHA-256 `sha256`, `scopes`, UTC `expires_at`, and `revoked`. Optional
`revoked_at` is a UTC timestamp; once it is in the past the key is dead.
Removing an entry also revokes it. The server reads the variable on every
request. Hashes only — never put a bearer token in the variable.

Scopes are `read_queue`, `decide`, and `propose`. A key only receives the
scopes listed. Expired, revoked, missing, and unknown tokens are `401
{"error":"unauthorized"}`. A live key without the scope is `403
{"error":"forbidden"}`. Those bodies do not say which check failed. An empty
or malformed variable is `503 {"error":"curator_unavailable"}` so a missing
Railway setting is not mistaken for a bad token.

`ADMIN_TOKEN`, the Desk cookie, and `GRANTS_WATCH_READER_KEYS` do not
authenticate this API.

Mint a key from a trusted shell. The token is written to a new mode-0600 file
and is not printed:

```bash
node scripts/create-curator-key.mjs hedwig Hedwig read_queue,decide,propose \
  2027-01-01T00:00:00Z ./hedwig-curator-token
```

Stdout is one JSON object. Merge it into the existing array. Do not replace
other clients' entries. Put the file's contents in the agent's secret store,
not in git, chat, or a URL.

Send `Authorization: Bearer TOKEN` on every request. Responses are
`private, no-store` and do not enable browser CORS.

## Writes

`Idempotency-Key` is required on decide, review, and propose. Use 8 to 128 characters
from `A-Z a-z 0-9 . _ : -`. The same key and body replay the first response
and send `Idempotent-Replayed: true`. The same key with a different body is
`409`. A key held by a request still in progress is `409`. Completed replays
last 24 hours. A claim still pending after 15 minutes can be taken over; the
Desk's own state check and proposal dedupe still prevent a second apply.

Writes are limited to 30 per minute per key per process. The limit resets on
restart and is not a quota across Railway replicas. `429` includes
`Retry-After`.

## Queue

`GET /api/v1/curator/queue` needs `read_queue`. It lists pending judgment and
fact items, oldest first.

```bash
curl -sS -H "Authorization: Bearer $CURATOR_TOKEN" \
  "https://grants.watch/api/v1/curator/queue?lane=fact&wire=ai&score=high&q=optimism&page=1&limit=50"
```

Filters: `lane` (`judgment` or `fact`), `type`, `wire` (`crypto`, `ai`,
`oss`), `score` (`high` is 80+, `mid` is 60–79, `low` is below 60),
`min_score` (0–100), `q` (title, summary, org, program, id). Unknown
parameters are `400`. `meta.pending_judgment` and `meta.pending_fact` are the
unfiltered pending counts.

`GET /api/v1/curator/queue/p00042` returns the proposed change, source URLs,
verbatim quotes, wire evidence when the item came from a signal, and the same
destination preview the Desk uses.

## Decide

`POST /api/v1/curator/queue/p00042/decide` needs `decide`. `reason` is required
(8–2000 characters). `sources` is an optional list of https URLs.

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: decide-p00042-1" \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved","reason":"Official program page states the new close date.","sources":["https://example.org/grants"]}' \
  "https://grants.watch/api/v1/curator/queue/p00042/decide"
```

Reject is the same call with `"decision":"rejected"`. The Desk Log records
`curator · Hedwig` plus the reason. Approve writes the registry through the
Desk committer. On Railway, `GRANTS_WATCH_NO_GIT=1` stores the change in the
existing Postgres ledger instead of committing inside the container. A merge
or a proposal that asks to delete is `403` and does not call that path.

## Review

`POST /api/v1/curator/queue/p00042/review` needs `propose` and an
`Idempotency-Key`. It writes a curator annotation onto the proposal. It does
not approve, reject, or otherwise change `state`. Only the owner decides, from
the Desk.

The annotation is stored on the existing `desk_proposals.data` JSON:
`curator_review` is the latest note, and `curator_review_history` keeps every
note, oldest first. No new column and no migration. Deploy is the app deploy.
`scripts/migrate-desk.mjs` does not need to run for this route.

`verdict` is `approve`, `reject`, or `needs_owner`. `reason` is 1–300
characters. `sources` is one to eight objects, each an official `https` URL
and a verbatim `quote` (1–2000 characters). Optional `facts` may set only
`status`, `deadline` (`YYYY-MM-DD`), `amount`, `org_name`, and `program_name`.
Unknown fields are `400`. A proposal that is already decided is `409` and is
left unchanged. A missing id is `404`.

A merge, or a proposal that asks to delete, can still be annotated. Deciding
either one stays `403`.

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: review-p00042-1" \
  -H "Content-Type: application/json" \
  -d '{
    "verdict": "reject",
    "reason": "The page describes a research office, not an open grant.",
    "sources": [{"url": "https://arpa-e.energy.gov/about", "quote": "ARPA-E advances high-potential energy technologies."}],
    "facts": {"status": "paused", "org_name": "ARPA-E"}
  }' \
  "https://grants.watch/api/v1/curator/queue/p00042/review"
```

The response is `{ "ok": true, "id", "state", "verdict", "at" }`. `state` is
the proposal's state, still `pending` after a review. The Desk shows the
latest note in place of the generated verdict: `Curator: Reject — <reason>`,
the source domain and quote, and any corrected facts that differ from the
proposal. `GET /api/v1/curator/queue/p00042` returns `curator_review` and
`curator_review_history`.

## Propose

`POST /api/v1/curator/proposals` needs `propose`. Every proposal needs
`reason`, `summary`, and `sources`: one to eight objects with an official
`https` URL and a verbatim `quote` (at least 12 characters). The server stores
those quotes for the Desk; it does not fetch the URL. The item is attributed
to the key and appears in the Desk Log as `Queued` / `curator · Hedwig`.

New organization:

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: org-example-foundation-1" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "new_org",
    "name": "Example Foundation",
    "wire": "oss",
    "website": "https://example.org",
    "summary": "Example Foundation runs a standing open-source grant.",
    "reason": "No organization file matches this name or site.",
    "sources": [{"url": "https://example.org/grants", "quote": "Example Foundation awards open source grants."}]
  }' \
  "https://grants.watch/api/v1/curator/proposals"
```

New program (the organization must already be on file):

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: program-example-grants-1" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "new_program",
    "org_id": "example-foundation",
    "program_name": "Example Grants",
    "wire": "oss",
    "apply_url": "https://example.org/grants/apply",
    "summary": "Rolling grants for open source maintainers.",
    "reason": "The foundation page describes a program that is not on file.",
    "sources": [{"url": "https://example.org/grants", "quote": "Applications are accepted on a rolling basis."}]
  }' \
  "https://grants.watch/api/v1/curator/proposals"
```

Fact updates use `"kind":"fact"` and `fact`:

| `fact` | Required fields | Desk type |
| --- | --- | --- |
| `deadline` | `program_id`, `round`, `closes` (`YYYY-MM-DD`) | `deadline_change` (Facts) |
| `round_dates` | `program_id`, `round`, `opens` and/or `closes` | `round_update` (Facts) |
| `status` | `entity` `program` or `org`, the matching id, `status` | `status_change` (Facts). The submission `summary` is written onto the program summary (at least 40 characters) or the organization profile (at least 60). |
| `summary` | `program_id`. The submission `summary` replaces the program summary and must be at least 40 characters. | `profile_note` (Judgment) |
| `identity` | `entity` `program` or `org`, the matching id, and `name` and/or `description` | `profile_note` (Judgment). `name` is the display name. The file id does not change. `description` replaces the program summary (at least 40 characters) or the organization profile (at least 60). |
| `wire` | `program_id` and `wire` (`crypto`, `ai`, or `oss`) | `profile_note` (Judgment). Replaces the program's wire list with that one wire. The proposal stores the program file's SHA-256, and approval refuses to apply if the file changed after the proposal was queued. |
| `round_merge` | `program_id`, `round` (the duplicate), `into` (the round that remains) | `round_update` (Facts). The duplicate is removed. Dates, size, and source copy onto the remaining round only where that round is blank. Both source URLs stay on the program. |
| `round_disposition` | `program_id`, `round`, `disposition` `withdrawn` or `duplicate` | `round_update` (Facts). The round stays on the program with its name, dates, and source, and leaves open and announced lists. |
| `amount` | `amount_target` `round` (`program_id`, `round`, `amount`) or `award` (`org_id`, `grantee`, `amount`, `date`) | `round_update` or `new_award` (Facts) |
| `x_handle` | `org_id`, `x` | `profile_note` (Judgment). An X handle is not a fact-lane type, so Sov sees it in Judgment. |

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: deadline-example-grants-1" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "fact",
    "fact": "deadline",
    "program_id": "example-grants",
    "round": "2026",
    "closes": "2026-12-01",
    "status": "open",
    "summary": "The program page moved the 2026 close to 1 December.",
    "reason": "Primary page states the new deadline.",
    "sources": [{"url": "https://example.org/grants", "quote": "Applications close on 1 December 2026."}]
  }' \
  "https://grants.watch/api/v1/curator/proposals"
```

A matching organization or program already on file returns `409` and `matches`.
Search before proposing. Renaming onto a name already on file does the same.

Replace a program summary:

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: summary-example-grants-1" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "fact",
    "fact": "summary",
    "program_id": "example-grants",
    "summary": "Rolling grants for open source maintainers, paid after a public review.",
    "reason": "The program page states the public summary. The registry still has a placeholder.",
    "sources": [{"url": "https://example.org/grants", "quote": "Rolling grants for open source maintainers."}]
  }' \
  "https://grants.watch/api/v1/curator/proposals"
```

Rename a program and replace its description. Omit either `name` or `description` to leave that field alone. Organization edits use `"entity":"org"` and `org_id`; `description` is the profile.

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: identity-example-grants-1" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "fact",
    "fact": "identity",
    "entity": "program",
    "program_id": "example-grants",
    "name": "Example Maintainer Grants",
    "description": "Rolling grants for open source maintainers, paid after a public review.",
    "summary": "The program page uses this name and description.",
    "reason": "The registry display name does not match the program page.",
    "sources": [{"url": "https://example.org/grants", "quote": "Example Maintainer Grants are open to maintainers."}]
  }' \
  "https://grants.watch/api/v1/curator/proposals"
```

Merge a duplicate round into the round that should remain. `round` is removed. `into` keeps its own dates, size, and source, and gains any of those only when it does not already have them.

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: merge-round-example-1" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "fact",
    "fact": "round_merge",
    "program_id": "example-grants",
    "round": "41",
    "into": "Round 41 grants",
    "summary": "The round named 41 is the same call as Round 41 grants.",
    "reason": "Both rounds cite the same application thread.",
    "sources": [{"url": "https://example.org/grants", "quote": "Round 41 applications close on 7 October 2026."}]
  }' \
  "https://grants.watch/api/v1/curator/proposals"
```

Mark a round withdrawn or duplicate without removing it. It drops off open lists. Its name, dates, and source stay on the program.

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: withdraw-round-example-1" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "fact",
    "fact": "round_disposition",
    "program_id": "example-grants",
    "round": "2026 side call",
    "disposition": "withdrawn",
    "summary": "The funder withdrew the 2026 side call before the deadline.",
    "reason": "The program page says this call was withdrawn.",
    "sources": [{"url": "https://example.org/grants", "quote": "The 2026 side call has been withdrawn."}]
  }' \
  "https://grants.watch/api/v1/curator/proposals"
```

Move a program from one wire to another. This is the sanctioned replacement for editing `wires` in the YAML by hand. Approval writes a Desk ledger row whose base hash is the file that was on disk, so boot replay can apply it. Do not edit that program file in Git while the proposal is still unapproved.

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: wire-nsf-americas-seed-fund-ai-1" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "fact",
    "fact": "wire",
    "program_id": "nsf-americas-seed-fund",
    "wire": "ai",
    "summary": "Move NSF SBIR/STTR from the crypto wire to the AI wire.",
    "reason": "The program page lists artificial intelligence among the technology areas it funds. The owner wants this program on the AI wire.",
    "sources": [{"url": "https://seedfund.nsf.gov/", "quote": "We fund startups across nearly all technology areas and markets like artificial intelligence, energy, medical devices, robotics, semiconductors, and many more."}]
  }' \
  "https://grants.watch/api/v1/curator/proposals"
```

The quote must be verbatim from the official page. A program already on that single wire returns `409`. Approve the queued item from the Desk. On Railway the approval lands in `desk_applied_changes` instead of a git commit inside the container. After it is serving, sync that new row with `scripts/sync-desk-commits.mjs` and confirm the deployment only once the image contains the commit.

Approve with the same decide call as any other queued item. These edits do not delete a registry file and they do not merge organizations.

## Search

`GET /api/v1/curator/search?q=example&kind=orgs` needs `read_queue`. `kind` is
`orgs` or `programs`; omit it to search both. `q` is at least 2 characters.
Results are id, name, status, wires, and a short summary — enough to see a
duplicate, not a second registry export.

```bash
curl -sS -H "Authorization: Bearer $CURATOR_TOKEN" \
  "https://grants.watch/api/v1/curator/search?q=example&kind=programs"
```

## Not available

These return `403 {"error":"forbidden"}` for an authenticated key, and `401`
with no key:

- `DELETE /api/v1/curator/queue/:id`
- `POST /api/v1/curator/bulk`
- `POST /api/v1/curator/merge`
- `POST`, `PUT`, `PATCH`, or `DELETE /api/v1/curator/config`
- deciding a `merge_orgs` item, or any proposal whose change asks to remove or delete
- a propose body with `kind` of `merge` or `delete`

Merging two rounds inside one program is `fact` `round_merge`, not `kind: merge`.

## Railway

The routes ship with this Next.js app. Production deploys from GitHub when
`main` updates, so merging this change deploys the code. Until
`GRANTS_WATCH_CURATOR_KEYS` is set, every curator request returns `503
{"error":"curator_unavailable"}` and does not read or write the Desk store.
Set the variable only on the grants-dot-watch service, after the code is
deployed. Saving it restarts that service and turns the API on. Do not set it
on wire-room-ops or on the grant-wire-scout jobs, and do not reuse
`ADMIN_TOKEN`, `GRANTS_WATCH_READER_KEYS`, or `INTERNAL_API_KEY`.

Leave `DATABASE_URL`, `WIRE_DATABASE_URL`, `GRANTS_WATCH_NO_GIT`,
`INGEST_ENABLED`, and `DESK_OWNERS` as they are. Do not add a migration and do
not write the Wire Room database. Scout crons and wire-room-ops keep their own
schedules. Revocation takes effect on the next request after the updated
variable is live.
