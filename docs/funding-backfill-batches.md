# Build the combined evidence-backed candidate batch

The source compiler accepts one to eight reviewed bundles, up to eight MiB in total and fifty source snapshots. Duplicate input files and malformed envelopes are rejected before any output is created. All source identity, representation-hash, date, reference, duplicate, conflict and schema checks remain in place.

```sh
# Read-only report for both retained batches. No fetch or approval occurs.
node scripts/build-funding-source-packets.mjs \
  --input research/v2/sources/batch-001.json \
  --input research/v2/sources/batch-002.json

# Materialize four candidate packets plus receipts and coverage reports.
# The output directory must not already exist and must be outside registry/.
node scripts/build-funding-source-packets.mjs \
  --input research/v2/sources/batch-001.json \
  --input research/v2/sources/batch-002.json \
  --out /tmp/funding-backfill-review
```

The retained batch produces 72 candidate records with 752 field assertions: 41 NumFOCUS award listings, 23 Microsoft project sponsorship listings and eight Royal Society historical process observations. The three missing program mappings have been added under existing organizations. Two source-excerpt omissions remain recorded as coverage gaps. These excerpts do not represent complete historical award ledgers.

Each packet obeys the existing single-program and 100-record Desk boundary as well as a 240-KiB serialized byte cap. Inspect `held.json`, `source_failures.json`, `coverage_gaps.json`, `claims.json` and `source_receipts.json` before previewing each packet through the Desk. Re-preview after an accepted packet changes the dataset. Compilation and external output do not enqueue, approve or publish anything.

All new records carry inline provenance; source text remains outside public records. Rights are unassessed. Exact payment dates, individual Microsoft amounts, and missing legal-payee identity are not manufactured. Historical grants and process counts are not current actionable application windows.

The first PR #38 CI run compiled and previewed all 72 records successfully but failed one test's expectation of an error string. A rejected nullable object reports a generic nullable-value error. The regression now asserts rejection, refusal by the public reader and non-disclosure of the private marker, without weakening validation. The final CI run must still pass before release.
