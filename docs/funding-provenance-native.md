# Field provenance, native capture and backfill expansion

This implementation extends the source adapters introduced in PR #37. It does not activate a production funding import, API gate, owner approval, or collection schedule.

## Evidence follows the data

V2 terms, funding events and process metrics may now include `provenance`. It contains bounded source receipts and field assertions. Every assertion binds a JSON Pointer to the exact public value's SHA-256 digest, a declared extraction/normalization/withholding rule, and source-representation line locators. Source receipts retain URL, observation date, provider, representation, scope, content hash and an optional pinned GitHub revision. The schema rejects extra fields, invalid pointers, mismatched values, unknown source references and unsupported permission claims.

Evidence survives the same JSONL serialization, Desk packet validation and public API allowlist as its record. A changed amount with unchanged evidence fails validation. This catches internal inconsistency; an attacker or editor able to alter both evidence and value can recompute hashes. Hashes are not signatures, independent factual verification, source completeness or proof of redistribution rights. Source text itself is not embedded in public records. Redistribution defaults to `unassessed`; a permission/license classification requires a rights-source URL and still needs operator review.

The existing contract remains valid for records without provenance. The prior schema implementation is preserved in `funding-model-core.mjs`; the wrapper adds optional fields and delegates all existing identity, amount, lifecycle and reference checks. Existing v1 code and data are not rewritten. Three new program mappings are the only canonical registry additions in this slice; they will appear in v1 once this change is deployed.

Event records also retain the published proposal purpose and an explicit recipient project URL when supported. Process metrics retain the published rounded percentage and validate it against the eligible-application denominator. Numerical row locators and table-wide exclusion statements stay separate. A financial year, source publication date, award date and payment date remain different facts.

## Native acquisition boundary

`capture-funding-source.mjs` supports only the allowlisted public `microsoft/foss-fund` repository. It can resolve the latest README-changing revision or accept an explicit 40-character commit SHA, then fetch the contents API at that revision. It verifies the Git blob hash, byte length, Base64 and UTF-8 representation. It selects one explicitly named FOSS Fund section and refuses ambiguous headings, narrative continuations and unsupported recipient shapes.

Limits: at most two requests, ten-second timeout per request, two-MiB response cap, 512-KiB decoded source cap, no redirects, no automatic retry, no credentials, no arbitrary URL. Capture is explicit and writes only a new external directory. There is no Desk, database or publication path.

```sh
# No network by default.
node scripts/capture-funding-source.mjs --source microsoft-foss --fund 35

# Explicit one-shot source capture. Use a new external output directory.
node scripts/capture-funding-source.mjs --source microsoft-foss --fund 35 \
  --revision 621eedf7a92ed5ce562a0820f3bda0c636ea5522 \
  --fetch --out /tmp/funding-native-capture

# Compile into candidates; review the report before Desk preview.
node scripts/build-funding-source-packets.mjs \
  --input /tmp/funding-native-capture/bundle.json \
  --out /tmp/funding-native-candidates
```

The full source representation is hashed but only the selected section is retained. A capture receipt records source start/end lines. Public evidence line numbers refer to the selected representation, not directly to the full README. This is not a complete source archive. Other providers remain connector-fed; no generic crawler or Exa/Parallel account client is added here.

CI has a separate, bounded native-source smoke job against the pinned public Fund 35 source. It requires no source credentials and publishes no funding data. No scheduled freshness collector is installed. A source outage can fail that smoke job independently of unit tests; it must not be reported as successful collection.

## Program identity and batch coverage

Three source-backed program mappings resolve the earlier 22 mapping holds:

- Microsoft FOSS Fund under the existing `microsoft` organization. Its operator is the Microsoft Open Source Programs Office; nominations and selection are internal. The older organization-shaped `microsoft-foss-fund` alias is retained for later identity reconciliation, not silently merged or deleted.
- Royal Society Research Grants under `royal-society`, with its concluded 2026 round 1 entry window.
- Royal Society University Research Fellowship under `royal-society`, with the 2027-labelled call's September 2026 close date.

A closed entry window does not make the continuing program concluded. None of these mappings introduces an actionable v2 opportunity. The Royal Society programs support natural sciences generally; the inherited legacy wire taxonomy does not make them AI-exclusive funds.

The target combined compilation of `batch-001.json` and `batch-002.json` is 72 observations across four programs: 41 NumFOCUS award listings, 23 Microsoft recipient listings and eight Royal Society process observations. The new retained Fund 35 excerpt contributes nine historical recipient listings. Two provider omissions in the original Royal Society extracts remain visible as coverage gaps. Current CI output, not this target, establishes actual accepted counts and hold reasons.

Microsoft individual amounts, legal payees and payment dates remain unknown. A source-stated pool is never allocated across recipients. These are candidate records; canonical funding-event and process-metric ledgers stay untouched until a current Desk preview and owner decision. The 416-organization corpus is not fully backfilled.

## Payload and replay controls

Source packets obey both the 100-record limit and a 240-KiB serialized-packet limit, below the Desk's 256-KiB pack cap. A single oversized record is held. Splitting keeps deterministic keys and does not change the approval boundary. Repeated semantic records remain no-ops; changed records require an explicit reviewed supersession. Source omissions never delete prior records.

The compiler's external claim report and inline provenance use the same field-specific locators. Historical field assertions identify normalized values and deliberate nulls; they do not convert an announcement into a payment or claim an individual applicant's probability of success.

## Remaining scope

Independent evidence review and controlled production import; wider source adapters and historical corpus recovery; rights assessment; source-text archival where permitted; a dedicated public claims/history API; operator evidence/diff UX; populated multi-replica and backup/restore verification. Keep the public v2 and funding-write gates unchanged during this work.

Primary references:
- https://github.com/microsoft/foss-fund/blob/621eedf7a92ed5ce562a0820f3bda0c636ea5522/README.md
- https://royalsociety.org/grants/research-grants/
- https://royalsociety.org/grants/university-research/
- https://numfocus.org/programs/small-development-grants
- https://docs.github.com/en/rest/repos/contents
