# Curator API

Hedwig, or any other agent acting for Sov, can read the Desk queues, decide
items, and propose changes without the Privy-gated `/admin/desk` UI. Approve
and reject call the same `decideProposal` path as the Desk buttons, including
the registry write and the `GRANTS_WATCH_NO_GIT` ledger. Proposals go through
`insertIngestProposals`, the same queue insert as wire ingest, and show up on
the Desk for Sov to approve.

This API cannot delete registry files or merge organizations, and it cannot
change `ADMIN_TOKEN`, reader keys, or `DESK_OWNERS`. It does not accept
`ADMIN_TOKEN`, reader keys, or the wire-room-ops `INTERNAL_API_KEY`.
`POST /api/v1/curator/bulk` stays forbidden. Low-risk bulk decide is a
separate route, described below.

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

Scopes are `read_queue`, `decide`, `propose`, and `apply_low_risk`. A key only
receives the scopes listed. `apply_low_risk` is not included unless it is
named. Expired, revoked, missing, and unknown tokens are `401
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

To grant `apply_low_risk` to an existing key, add that scope to its entry.
The bearer token does not change, and this command does not print one. On a
trusted shell where `GRANTS_WATCH_CURATOR_KEYS` is already set, print the
updated hash array and save that stdout back into the variable. Do not paste
the array into chat.

```bash
node scripts/grant-curator-scope.mjs elouise apply_low_risk
```

`elouise` is the key's existing `id`, not the token. If the variable is not
in the shell environment, pass the current hash array with `--keys-file`.
Stdout is the full array. Merge nothing else by hand after it runs: the
script keeps every other key. `CURATOR_AUTO_APPLY=0` stops auto-apply without
removing the scope. Unset `CURATOR_AUTO_APPLY_TYPES` allows `x_handle` only;
set it to a comma-separated list to change that. An empty value allows nothing.

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
| `x_handle` | `org_id`, `x` (a handle, or `null` to clear) | `profile_note` (Judgment). An X handle is not a fact-lane type. `null` removes `socials.x` from the organization file. It does not delete the file. |

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

Set an X handle:

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: x-example-foundation-1" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "fact",
    "fact": "x_handle",
    "org_id": "example-foundation",
    "x": "example",
    "summary": "The foundation site links this X account.",
    "reason": "The official site shows the handle in the footer.",
    "sources": [{"url": "https://example.org/about", "quote": "Follow Example Foundation at https://x.com/example."}]
  }' \
  "https://grants.watch/api/v1/curator/proposals"
```

A key with `apply_low_risk` auto-approves that proposal when all of these hold.
Otherwise the item stays pending, the same as any other proposal.

- `x_handle` is in `CURATOR_AUTO_APPLY_TYPES` (the default list is `x_handle`).
- `CURATOR_AUTO_APPLY` is not `0`.
- The change adds or replaces a handle. `x: null` is not auto-approved on submit.
- A source URL host is the organization's registered website, or a subdomain of it. `www` is ignored. A sibling or lookalike host does not match. `x.com` and `twitter.com` are not treated as an organization's site.
- The quote on that source contains `x.com/<handle>` or `twitter.com/<handle>` for that exact handle. A longer handle, or a status path under the handle, does not match. Match is case-insensitive.
- The server fetches that URL (8 second timeout, 1 MB cap), follows redirects only while they stay on the same site, and finds the same link in the page. Private and loopback addresses are refused.

The approval calls `decideProposal`. The reason stored on the verdict is the proposal reason prefixed with `auto:`. The Desk Log actor is `curator · <name> · auto-apply`. The verdict records the key id, the fetched URL, the SHA-256 of the page bytes, and the old and new handle values.

Clear a dead handle. This stays pending on submit. Apply it with the bulk route below. The written reason is the evidence. The same `apply_low_risk` scope is required, and the verdict records the old value and a null new value.

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: x-example-foundation-clear-1" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "fact",
    "fact": "x_handle",
    "org_id": "example-foundation",
    "x": null,
    "summary": "The X account named on this organization no longer exists.",
    "reason": "The account returns a not-found page and the site no longer links it.",
    "sources": [{"url": "https://example.org/about", "quote": "The about page no longer links an X account."}]
  }' \
  "https://grants.watch/api/v1/curator/proposals"
```

## Bulk decide

`POST /api/v1/curator/queue/decide-bulk` takes `ids`, `decision`, and `reason`.
`sources` is optional, the same https list as a single decide. At most 50 ids,
all the same proposal type, no duplicates. `Idempotency-Key` is required.

A key with `decide` may approve or reject that batch. Each `x_handle` add or
replace is verified again with the same org-site, quote, and page checks
before it is approved. A failed check stays pending and is listed in `failed`.
A key with `apply_low_risk` and without `decide` may only approve a batch of
allow-listed `x_handle` items, and only while auto-apply is on.

`x: null` clears are approved on this route when the key has `apply_low_risk`,
auto-apply is on, and the request reason is present. The proposal must already
carry a source. One verdict is written per id, including the auto-apply audit.
`CURATOR_AUTO_APPLY=0` leaves those items pending (`failed` error `disabled`).

```bash
curl -sS -X POST -H "Authorization: Bearer $CURATOR_TOKEN" \
  -H "Idempotency-Key: bulk-x-handles-1" \
  -H "Content-Type: application/json" \
  -d '{"ids":["p01939","p01940"],"decision":"approved","reason":"Each official site links the handle in the quote."}' \
  "https://grants.watch/api/v1/curator/queue/decide-bulk"
```

The response is `{ "ok": true, "decided": ["p01939"], "failed": [{ "id": "p01940", "error": "page_missing_link" }] }`.

## Desk Log

Auto-applied rows are labeled `curator · <name> · auto-apply` and can be
filtered with Auto-applied. Each row shows the key id, fetched URL, page hash,
and the old and new values. Revert writes the old value back onto the
organization and marks the row reverted. It is an owner action on the Desk,
not a curator route.

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
- `POST /api/v1/curator/bulk` (use `POST /api/v1/curator/queue/decide-bulk`)
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
