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

Per-source owner refreshes permit at most four starts per minute per process and one active capture. No recurring collector or publication scheduler is enabled. This process-local guard is not a paid multi-replica quota contract.

## Release verification

Before public activation: existing and new tests must pass; source facts must be reviewed; import a canary through the owner flow; verify accepted rows and source evidence; redeploy to a fresh image and compare the funding dataset and v1 records. Keep public and funding-write gates independent. Do not retire ready outbox rows merely because local data is present.

Coverage identifies all current organizations and distinguishes legacy facts from typed enrichment. Gaps, undisclosed values, unresolved identities and unsupported source shapes remain visible. Complete award histories, causal impact and source reuse permission are never inferred from a successful parser or a hash.
