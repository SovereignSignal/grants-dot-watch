# Funding website, operator workspace and API release

This release connects accepted funding records to the public website and adds a usable operator interface. It does not equate the original research pass with exhaustive verified funding history.

## Public surfaces

- `/funding`: searchable, cursor-paginated funding events, program terms, process observations, source claims, relationships, changes and linked projects.
- `/data`: live API documentation, exact counts, scope qualifications, OpenAPI and bounded JSON/JSONL exports.
- Program pages: a funding-evidence section joins accepted events, terms and process observations to the existing program. Existing award ledgers stay separate to avoid double counting.
- `/api/v2`: the original eleven resources plus claims, relationships, changes, outputs and organization coverage. Original collection contracts remain unchanged.

New relationships identify registry association, parent programs and explicitly recorded roles. An organization association is not automatically legal capital ownership. Project URLs are linked outputs only; delivery and causal impact stay unestablished. Existing public program facts carry the `registry_record` evidence label and are not described as newly verified.

`observed_since` and `effective_since` have separate meanings. The changes collection records observations and published history; it is not a retained historical snapshot service or guaranteed event-delivery mechanism. Unknown dates remain null. Exports have a 20,000-row and 16-MiB ceiling, with snapshot and row-count headers.

## Owner workspace

`/admin/funding` uses the existing admin/Privy session. Its `/api/desk/funding/workspace` route authenticates before reads or parsing. It supports current coverage/pending imports, retained research compilation, bounded source-bundle uploads and explicit first-party source refreshes. None of those operations approves data.

A packet is previewed against current canonical bytes, queued under its exact digest, then approved through the existing single-item owner Desk route. After one import, preview the next packet again. The existing durable prepared/ready outbox, control digests and restart recovery remain authoritative. No new direct database or filesystem publication path is added.

## Native source scope

Microsoft source capture can scan the supported repository-recipient sections of Funds 1–36 using one cached pinned source response and at most two external requests. Narrative or person-only sections are explicitly held. The capture is not a claim that later or unsupported funds do not exist.

The NumFOCUS small-development-grants and two Royal Society process-table adapters fetch only their fixed reviewed URLs, require an unambiguous exact table schema, retain exclusions and normalize native amounts without conversion. Each runs at most one request, with timeout, UTF-8 and byte bounds, and no redirects. HTML source text is not republished. Selected normalized representations have their own hashes and line locators.

Per-source refreshes permit at most four starts per minute per process and one active capture. The owner's buttons and the daily sweep below share that one guard. This process-local guard is not a paid multi-replica quota contract.

## Daily award-source sweep

With `AWARD_SOURCES_ENABLED=1` the daily ingest run (`INGEST_ENABLED=1`, the boot timer in `src/lib/ingest.ts`, once per product day under the ingest lock and day claim) finishes the Wire and discuss.watch ingest, then sweeps every native source in the workspace catalog. It also requires `GRANTS_WATCH_FUNDING_DESK=1`, since nothing it queues could be approved without it. The flag defaults off and is independent of the Wire flags.

Each source goes through the same functions as the workspace buttons: guarded capture (Microsoft in supported-archive mode), snapshot validation, compile, preview against current canonical bytes, then `insertIngestProposals`. A packet is queued only when its preview adds records. Packets whose records are all already pending or were rejected are no-ops, as is a packet whose digest is already on file. A packet that overlaps a pending item is held until the owner decides that item. A packet that mixes new records with records from an owner-rejected packet is held with reason `contains_rejected_records`: it is not re-queued and never auto-applies, so the rejected records do not come back daily. New records for that program then wait for the owner, who can compile and queue them from the workspace. At most 20 previews run per day; the rest wait for the next run. The sweep yields to the event loop between sources and packets.

Without auto-apply the sweep never approves. Funding imports are `profile_note` proposals, which the machine validator never auto-approves, and the owner decides each one through the single-item Desk route. A source failure is recorded and the other sources and the Wire ingest continue. The run summary (sources tried, packets queued, repeated, held, deferred, failed, auto-applied, and each packet left for the owner with its reasons) is stored as `award_sources` on the `last_run` ingest_state row and shown on `/admin/health`. Manual `/api/ingest/run` calls do not run the sweep.

## Auto-apply of clean award packets

`AWARD_SOURCES_AUTO_APPLY=1` lets a clean packet publish without an owner click. It defaults off, is independent of `AWARD_SOURCES_ENABLED`, and does nothing unless the sweep itself runs. Two kinds of packet are considered, one at a time: a new packet, right after its preview, and the sweep's own packets still pending from an earlier run. The sweep marks the proposals it queues with `origin: "award_source_sweep"`, and only marked proposals are retried. Each run first captures and compiles every source, then retries its pending packets, then handles new ones, so leftovers are tried before new packets can spend the cap. A packet is clean only when all of these hold:

- It came from a native, allowlisted first-party source (`SOURCE_CATALOG` and `NATIVE_REFRESH_SOURCES`).
- That source's capture compiled with no failed snapshot and no coverage gap; either one keeps every packet from the source on the Desk.
- No held record touches it. Held records carry the possible-duplicate, provider identity conflict, joint-beneficiary, unresolved program mapping and changed-existing-key checks, and the compiler already leaves them out of every packet. A held record blocks a packet of the same program that shares its recipient (slug or normalized name, including each part of a joint name) or, for a process metric, its period. Each catalog source maps to exactly one program, so program alone would not narrow anything. A held record that does not carry a catalog source and a recipient or period blocks every packet from the source.
- Every record is new: the preview's added count equals the record count, nothing is unchanged, and no record has `supersedes_key` or `legacy_award_key`.
- None of its records is pending in another Desk item or was in an owner-rejected packet.
- It holds only `awarded` funding events and process metrics, each naming the source's catalog program and issuer, and every program and organization resolves to a current registry entity whose file hash matches the pack's reference guard.
- It is within the Desk pack limits (1 to 100 records, 256 KiB) and the compiler's 240 KiB packet limit.
- Immediately before approval, a re-preview against the current canonical bytes reproduces the queued plan digest, and the funding writer lock is free.

If any condition fails or cannot be established from the compiler and preview outputs, the packet stays a pending Desk item exactly as before, listed in `left_for_owner` with its reasons. The rule is `packetReasons` and `mappingReasons` in `src/lib/funding-source-clean.mjs`.

A clean packet is approved through `decideProposal`, the same durable claim, apply, outbox and verdict path as an owner click; nothing writes files or rows directly. The verdict has `by: "machine"` and an `award_auto_apply` audit (policy, source, source URL, pack id, plan digest, record count), and `decideProposal` accepts that machine actor for a funding import only while the flag is on and only for the exact digest re-previewed. The Desk Log shows these rows as `machine · award auto-apply` under the Auto-applied filter. Funding ledgers are append-only, so there is no one-click revert. At most 10 packets auto-apply per run. A clean new packet that meets the cap or a busy writer is not queued: it is listed in `auto_apply_deferred`, and the next run sees it as new, previews it against then-current bytes and applies it. Queueing it would leave a plan that goes stale as soon as any other funding import lands. A queued packet that hits a busy writer during its final re-preview stays pending and is retried next run. A retry must still reproduce its queued plan digest; if another funding import has landed since it was queued, it stays pending with `preview_changed` for the owner to re-preview, as the owner workflow already requires. `decideProposal`'s claim ensures each proposal is approved at most once, whether by the owner or the sweep. A reconciliation hold stops auto-apply for the rest of the run. The run yields to the event loop before and after each re-preview and approval.

## Release verification

Before public activation: existing and new tests must pass; source facts must be reviewed; import a canary through the owner flow; verify accepted rows and source evidence; redeploy to a fresh image and compare the funding dataset and v1 records. Keep public and funding-write gates independent. Do not retire ready outbox rows merely because local data is present.

Coverage identifies all current organizations and distinguishes legacy facts from typed enrichment. Gaps, undisclosed values, unresolved identities and unsupported source shapes remain visible. Complete award histories, causal impact and source reuse permission are never inferred from a successful parser or a hash.
