# Program Quality Pilot

Date: 2026-07-14

## Scope

This pilot removes four reports that were represented as standalone funding programs. Each record had
zero award references, zero child programs, and zero funding-system references before removal.

## Changes

| Removed record | Finding | Evidence retained |
| --- | --- | --- |
| `otf-annual-report` | Organization-wide FY2024 annual report, not a program | No program merge target |
| `arbitrum-dao-s3-impact-report` | Retrospective for the existing Arbitrum DAO Grant Program | Added to `arbitrum-dao-grant-program-milestones-based-funding-via-arbi` |
| `optimism-cycle-51-grants-report` | Cycle review for the existing Optimism Grants Council Season 9 | Added to `optimism-grants-council-season-9` |
| `zcash-foundation-q1-2026-report` | Foundation-wide quarterly report, not a program | No program merge target |

The Arbitrum canonical record now reflects the official March 17, 2026 close of active submissions and
the subsequent low-capacity review and disbursement phase. Its organization homepage was removed from
`apply_url` because it was not an application endpoint.

## Sources

- [OTF Annual Report FY 2024](https://www.opentech.fund/wp-content/uploads/2026/06/OTF-Annual-Report-FY-2024.pdf)
- [Arbitrum DAO Grant Program Season 3](https://forum.arbitrum.foundation/t/arbitrum-d-a-o-grant-program-season-3-official-thread/28753)
- [Arbitrum DAO Grant Program Season 3 Impact Report](https://forum.arbitrum.foundation/t/arbitrum-d-a-o-grant-program-season-3-official-thread/28753/55?u=jojo)
- [Optimism Cycle 51 Grants Council Report](https://gov.optimism.io/t/cycle-51-grants-council-report/10671)
- [Zcash Foundation Q1 2026 Report](https://zfnd.org/zcash-foundation-q1-2026-report/)

## Result

- Programs before: 705
- Programs after: 701
- Semantic review candidates before: 27
- Expected semantic review candidates after: 23
- Related awards, child programs, or funding-system links removed: 0

The remaining semantic queue requires manual review. Several records describe real programs whose names
contain words such as "report," "update," or "thread," so the audit must remain advisory rather than an
automatic deletion step.
