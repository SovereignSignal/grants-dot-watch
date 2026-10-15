# Funding source adapters and first backfill batch

This slice adds reproducible source-to-packet processing. It is not an autonomous crawler, a full corpus migration, or public v2 activation.

## Implemented boundary

Three source-specific parsers handle four source surfaces: NumFOCUS historical award tables, Microsoft FOSS Fund repository-recipient lists, and application/offer tables for two Royal Society schemes. They consume bounded, explicitly scoped Markdown extracts captured through the existing research connectors. They make no network requests, use no API credentials, and cannot write canonical data or approve Desk proposals.

The source catalog fixes expected URLs, issuers and suggested program mappings. A compiler only emits a packet when the canonical program exists, has the expected owner, and has current program/organization Git blob guards. Unknown mappings are held for separate identity/program review. It never invents registry entities to make an import pass.

A source-body hash checks the supplied representation's integrity; it is not an issuer signature or evidence that a page was freshly fetched. Operators must review the source capture and provenance. `tool_text_excerpt` records are selected or reformatted tool output, not original webpage bytes. All retained observations explicitly state excerpt-only coverage. Redistribution rights remain unassessed. This pipeline does not authorize resale of source text.

## Run

```sh
node scripts/build-funding-source-packets.mjs --input research/v2/sources/batch-001.json
node scripts/build-funding-source-packets.mjs --input research/v2/sources/batch-001.json --out /tmp/grants-source-batch-001
```

The default reports a dry run. `--out` atomically creates one new external directory containing `packets/`, source receipts, field-level claim links, unresolved records, unchanged records, source failures, coverage gaps and the run report. Existing destinations and paths overlapping the canonical registry are rejected. There is no apply, fetch, scheduler or approval flag.

Each generated packet can be tested with the existing staging importer:

```sh
node scripts/stage-funding-import.mjs --pack /tmp/grants-source-batch-001/packets/PACKET_NAME.json
```

For canonical publication, use the existing authenticated funding Desk preview/queue and single-item owner decision workflow. Re-preview every packet against the current snapshot after an earlier approval. The source compiler itself never queues or approves. The daily award-source sweep (`AWARD_SOURCES_ENABLED=1`, see `docs/funding-live-product.md`) runs that same capture, compile, preview and queue sequence once per product day for the native sources. It approves nothing unless `AWARD_SOURCES_AUTO_APPLY=1`, and then only a clean packet of its own (first-party source, no failed snapshot or coverage gap, no held record touching that packet's recipients, no duplicate, identity, overlap or rejected-record flags, every record new and mapped to an existing registry entity, re-previewed against current bytes), through the same owner Desk approval function as a machine decision. Everything else stays on the Desk. Read/write feature gates and production settings remain unchanged.

## Evidence and normalization rules

- Quantities stay decimal strings and retain the configured source denomination. A selected Microsoft project has no individual amount unless the source discloses one. Never assign the quarterly pool to each recipient.
- A historical award listing creates an `awarded` candidate. Payment, announcement and exact occurrence dates remain null when undisclosed. Award year/round remains a separate period string.
- Recipient IDs are source/project scoped. They identify the named beneficiary project, not a verified legal payee. Joint beneficiary rows are held rather than multiplying an award. Potential overlap with existing award/event records is held for identity review.
- Royal Society counts retain fiscal year, counting unit and reserve exclusions. Published percentages are checked against the counts and their displayed rounding. No individual odds or implied payment is calculated.
- Natural source IDs omit amounts so revised values cannot masquerade as new awards. Repeated identical facts are no-ops. Existing changed keys require explicit reviewed supersession.
- Provider repetition is one fact with multiple extraction receipts, not multiple independent issuers. Different values are held. Different row coverage is logged as an omission; missing rows never delete old data.
- Malformed headers, truncated rows, unsupported recipient formats, duplicate source identities and invalid dates fail the affected source. Other source streams can proceed, but the run reports partial failure and exits with code 2.
- The evidence report links each extracted field to source URL, body digest, representation line and observation date. Fixed normalization decisions are adapter rules. This is a review artifact, not a new public claims API.

## Batch 001

The included six extracts were rechecked on October 4, 2026. They contain 41 NumFOCUS 2023/2024 project award listings, 14 Microsoft Fund 36 repository-recipient listings, and eight distinct Royal Society application/offer observations. The two Exa Royal Society extracts omit the newest fiscal-year row present in the separately retrieved page representations. Those omissions are retained as two coverage discrepancies.

The 63 distinct observations are not necessarily 63 importable records. The compiler reports held mappings, possible legacy duplicates and validation failures against the actual registry. Nothing in this batch certifies current program availability, payout or a complete organizational award history.

Sources:
- https://numfocus.org/programs/small-development-grants
- https://github.com/microsoft/foss-fund/blob/main/README.md
- https://royalsociety.org/grants/research-grants/
- https://royalsociety.org/grants/university-research/

## Remaining work

Resolve held program/recipient mappings through the existing review boundary; add tested acquisition clients and supported structured formats; extend provenance/rights metadata and amendment handling; backfill further retained dossiers. Records 1–200 still need claim-level evidence recovery. The 416-organization research sequence has not been bulk imported. The only recurring collection is the opt-in daily sweep of the four native sources; it queues for owner review, auto-applies only clean packets when that separate flag is on, and adds no sources.
