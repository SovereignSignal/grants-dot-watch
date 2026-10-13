# Registry v2 sidecars

Legacy `SCHEMA.md`, YAML files, old award ledgers and v1 enums are unchanged. Additive enrichment uses JSONL in three optional directories. Missing directories mean no enrichment. Malformed rows, extra fields and unresolved references invalidate the whole v2 dataset.

The machine-readable contract and publication allowlist share `src/lib/funding-model.mjs`. Print it with `node scripts/validate-registry-v2.mjs --print-schema`. Validate with `npm run validate:funding`.

## program-terms

Required: key, program, source, checked_on, evidence_state, evidence_note, instruments, allocation_methods, capital_forms, selection_models, intake_mode, resources.

Optional: round_name, validity dates, supersedes_key, operator_org, capital_source_orgs, disburser_org, budget, eligibility, geography, requirements, reporting_requirements, access, provenance.

`round_name` scopes historical/cohort facts; omission means program-level scope. Sources and checked dates apply to the explicitly scoped record. Independent resource components preserve units and restrictions. Unknown fields are absent or null according to the schema, never inferred from zero.

Access records name the round, entry stage, intake state, new-applicant eligibility, cleared prerequisites, route, source, checked_on and review_after. An open access claim requires primary-supported evidence and explicit true entry/prerequisite flags.

## funding-events

Required: key, award_id, event_type, funder, recipient, recipient_name, program (nullable), amount, capital_form, occurred_on (nullable), announced_on (nullable), payment_date (nullable), and the four evidence fields.

Optional: round_name, award_period, milestone, tranche, conditions, legacy_award_key, supersedes_key, purpose, recipient_url, provenance. `purpose` describes the recorded funded work; `recipient_url` points to the recipient project and does not prove delivery.

Event types: recommended, approved, awarded, contracted, paid, withdrawn, challenged, rejected, refunded, clawed_back. Keys deduplicate events; award_id groups their lifecycle. Program/funder/recipient identities cannot change within an award. Mapping to an existing legacy award must agree with its identity. A payment is never inferred from an approval or an announcement date.

Money fields use decimal-string amount or null, currency or null, unit, and qualifier (exact/up_to/approximate/not_disclosed), plus optional amount_text. Currency is required for disclosed monetary units. No conversion or total of mixed resource types is performed.

## process-metrics

Required: key, program, period, counting_unit, exclusions and evidence fields. Counts for applications, eligible_applications, shortlisted, offers, accepted and funded are nullable nonnegative safe integers. At least one measured count is required. Where both are given, eligible cannot exceed applications, offers/shortlist cannot exceed eligible, and accepted cannot exceed offers. Optional: round_name, published_percent, provenance. A published percentage must agree with offers / eligible_applications at its stated precision. Published cohorts and exclusions remain attached. No individual odds or causal quality score is inferred.

## Classification and provenance

See [registry conventions](../docs/registry-conventions.md) for the independent
classification axes and program/round identity rules. Existing enums live in
`funding-model-core.mjs`; no legacy-mechanism conversion is implicit.

Optional `provenance` on all three ledgers binds field assertions to source
representation hashes, observation dates, provider, scope, revision (when known),
line locators and redistribution metadata. Assertions carry field/value hashes,
method (source_stated/normalized/withheld) and a normalization rule. Withheld
assertions must have null values. Raw source text is not published. A hash binds
the representation, not its truth or completeness; omitted provenance does not
mean a record was independently verified.

## Safety and workflow

Append-only imports require reviewed stable keys, source guards and valid references. Supersessions must stay in the same scope and cannot form cycles. Public output selects fields explicitly; operational metadata has no sidecar schema slot. Source URLs reject credentials and credential query parameters. This is a URL hygiene check, not independent proof of issuer authority.

The staging CLI in `docs/api-v2.md` creates disposable review copies. The separate default-off Desk writer in `docs/funding-desk.md` previews, queues and applies imports only through owner review and the durable outbox. It writes immutable shards plus a shared `funding-control.json` with version, predecessor hash, revision and complete dataset hash. Both public reads and CLI validation reject a mismatched control or Desk shards whose control is missing. The control is operational consistency metadata and is not a public funding record.

No new database schema, recurring collector, production backfill or production activation is introduced by these files.
