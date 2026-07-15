# Program Quality Batch 4

Date: 2026-07-15

## Scope

This batch separates funding programs from their result announcements. Three result posts are merged
into canonical program records and award data. One Filecoin roundup is restructured in place as the
underlying ProPGF Batch 2 program.

## Changes

| Record | Previous issue | Correction |
| --- | --- | --- |
| `optimism-grants-council-cycle-50-results` | A cycle report was stored as a standalone program with the Optimism homepage as its application URL | Merged the official report into Season 9 and recorded Gamma Strategies' 300,000 OP award |
| `unitary-foundation-grant-awarded` | One award announcement was stored as a program with the foundation homepage as its application URL | Recorded the Evan Dobbs award under Unitary Foundation Microgrants without inferring an unstated amount |
| `zcash-grants-approved-q1` | Four approved grants were stored as a standalone program | Recorded the four awards and corrected the canonical Zcash Community Grants record |
| `filecointldr-filecoin-announces-3-22m-in-public-goods-fundin` | A roundup title and incorrect timeline obscured the underlying funding round | Renamed it Filecoin ProPGF Batch 2, added the official result, and recorded all 16 awards |

The three organization-homepage application links were removed with their redundant records. The
Filecoin record keeps its existing ID so its public route remains stable.

## Sources

- [Optimism Cycle 50 Grants Council Report](https://gov.optimism.io/t/cycle-50-grants-council-report/10653)
- [Unitary Foundation Grants](https://unitary.foundation/grants/)
- [Zcash Community Grants](https://zcashcommunitygrants.org/)
- [Zcash Community Grants selection process](https://zcashcommunitygrants.org/selection/)
- [Zcash Community Grants meeting minutes, February 16, 2026](https://forum.zcashcommunity.com/t/zcash-community-grants-meeting-minutes-2-16-26/54737)
- [Filecoin ProPGF Batch 2 results](https://www.filecoin.io/blog/filecoin-propgf-batch-2-general-track-322m-allocated-to-core-infrastructure-and-ecosystem-builders)

## Result

- Programs before: 696
- Expected programs after: 693
- Awards added: 22
- Semantic review candidates before: 15
- Expected semantic review candidates after: 11
- Referenced deleted routes: 0
