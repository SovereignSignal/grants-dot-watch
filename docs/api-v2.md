# Public API v2

V2 is an additive preview over the canonical registry. V1 remains unchanged.

## Endpoints
- GET /api/v2
- GET /api/v2/programs?mechanism=&capital_form=&selection_model=&org=&status=
- GET /api/v2/opportunities
- GET /api/v2/funding-events?event_type=&program=&recipient=&funder=
- GET /api/v2/process-metrics?program=&period=

## Semantics
An opportunity is a currently listed open/announced round after the registry's existing review gates. It is not a guarantee that an applicant is eligible; source terms govern.

Funding events are lifecycle records. Recommended, approved, awarded, contracted and paid are distinct states. Aggregators must not sum every lifecycle event as independent capital.

Unknown values remain null. Native token, credit, compute, service and subsidy values are not converted to USD without explicit valuation evidence.

## Compatibility
Existing YAML remains valid. Typed `terms` fields and the two new append-only ledgers can be backfilled gradually. No v1 response field changes are required.
