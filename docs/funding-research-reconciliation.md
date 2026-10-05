# Retained research reconciliation

A research pass, a verified claim, an accepted canonical record and a complete historical funding ledger are distinct deliverables. This tool connects the retained research files to the live registry without promoting an earlier research label into new primary evidence.

## Input and trust boundaries

Use the retained `dossiers-201-350.json` and `source-index.json` from the research archive, the original inventory directory and a successful public verifier's `public-data.json` plus `receipt.json`. The receipt hashes must match the supplied public rows. This checks internal consistency, not a signature or proof against someone able to replace both files. The inventory revision is explicitly declared by the caller; its provenance must be retained with the source artifact.

```sh
node scripts/funding-closeout/reconcile-research.mjs \
  --dossiers /path/to/dossiers-201-350.json \
  --source-index /path/to/source-index.json \
  --inventory /path/to/frozen-registry/orgs \
  --inventory-ref 71d96d4e3bd9af3c514fe39f819aa4e0f2ef5649 \
  --live /path/to/public-data.json \
  --receipt /path/to/receipt.json \
  --out /tmp/research-reconciliation-new
```

The command makes no network calls, owner decisions, registry writes or source-rights assertions. It rejects duplicate identities, out-of-inventory IDs, malformed source indexes, unbounded structures and mismatched public receipts. Its report preserves the exact source record, every primitive or empty-container leaf, artifact metadata and source-index entries. Text that resembles an instruction remains literal data.

## Mapping contract

Stable organization IDs determine identity. Batch ordinals are retained as historical metadata and compared against the supplied inventory order; they never choose the target funder. Each retained field has an explicit disposition: contextual data, source locator, research assertion, work item, candidate schema path requiring review, or an unresolved mapping/schema extension. No unmatched value is discarded. A schema hint is not a valid funding packet or a claim that the value belongs to a particular program.

Financial values require amount meaning, instrument, currency, scope, eligibility and source verification before normalization. Source IDs are resolved only through the supplied index. Unresolved references remain visible. The report does not infer approval, payment, open intake, a legal payee, source permission or complete history.

## Verified artifact reconciliation

The retained bundle supplies 150 claim-level dossiers for records 201–350, with 310 research findings and 5,125 retained field values. Reconciliation against the downloaded live verification snapshot finds all 416 frozen IDs still present and 12 additional live organizations. Eleven recorded positions differ from the supplied inventory's lexicographic order; stable-ID matching resolves these without reattribution. All supplied source-index references resolve.

This does not mean 266 organizations were never researched. It means the supplied dossier bundle does not contain claim-level dossiers for those 266 IDs. The earlier 1–200 discussion and final 351–416 narrative synthesis are separate evidence forms. They must not be relabeled as equivalent structured dossiers or automatically imported as verified historical awards.

Original research artifacts remain private review inputs. Only separately reviewed source-backed packets cross the existing owner Desk boundary into the public funding model. The research report contains no declaration that a program's complete funding history has been captured.
