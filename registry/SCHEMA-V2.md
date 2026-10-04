# Registry v2 additive schema

This directory remains the canonical public dataset. V2 is additive: existing v1 organization, program, round and award fields remain valid.

## Program typed terms

Programs may add a `terms` mapping:

```yaml
terms:
  capital_form: [cash, compute]
  selection_model: application
  intake_mode: rolling
  operator_org: example-foundation
  capital_source_orgs: [example-dao]
  disburser_org: example-foundation
  budget: { amount: 1000000, currency: USD, amount_text: "$1M" }
  award_min: { amount: 10000, currency: USD }
  award_max: { amount: 100000, currency: USD }
  eligibility: ["open-source teams"]
  geography: ["global"]
  requirements: ["milestone reporting"]
  application_route: "Open application"
  success_metrics: []
  reporting_requirements: []
```

`mechanism` now accepts grants, retro, quadratic, prize, fellowship, incubator, accelerator, rfp, bounty, subsidy, investment, procurement, purchase, sponsorship, credits and other.

Round records may add decision/payment dates, a structured pool, funnel counts, stage, and source_checked_on.

## funding-events/*.jsonl

Append-only lifecycle events. Approval and payment are separate events.

```json
{"key":"example:approved:1","event_type":"approved","funder":"example-foundation","recipient":"project","recipient_name":"Project","program":"example-program","decision_date":"2026-10-01","amount_native":50000,"currency":"USD","capital_form":"cash","source":"https://example.org/decision","evidence_checked_on":"2026-10-04"}
```

event_type: recommended | approved | awarded | contracted | paid | withdrawn | challenged | rejected | refunded | clawed-back.

## process-metrics/*.jsonl

Append-only published funnel metrics.

```json
{"key":"example-program:2026","program":"example-program","period":"2026","applications":100,"eligible_applications":90,"shortlisted":20,"offers":10,"accepted":9,"funded":9,"source":"https://example.org/report","checked_on":"2026-10-04"}
```

Counts remain nullable. Never calculate a rate from an unstated denominator.

## Evidence rules

* Preserve native units and currency.
* Do not infer payment from approval.
* Do not infer open intake from an active program.
* Do not infer cash value for credits, services, subsidies or compute.
* Keep source, observation/check date and applicable scope with every new structured fact.
