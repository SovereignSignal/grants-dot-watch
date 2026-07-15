# Program Quality Batch 2

Date: 2026-07-15

## Scope

This batch removes five content or governance records that were represented as standalone funding
programs. Each record had zero award references, zero child programs, and zero funding-system
references before removal.

## Changes

| Removed record | Finding | Evidence retained |
| --- | --- | --- |
| `graph-foundation-2025-grants-report` | Annual report for the existing Graph Grants Program | Added to `the-graph-grants-program` |
| `lido-lego-q3-2025-grants-report` | Quarterly report for the existing LEGO program | Added to `lido-lego` |
| `season-7-nominations-final-reviewer-on-the-grants-council` | Council election thread with a corrupted stored summary | No program merge target |
| `update-to-ctb-member-list` | Polygon Community Treasury Board personnel update | No program merge target |
| `source-optimism-governance-forum` | Duplicate placeholder with unsupported budget and deadline claims | Source already retained on `optimism-grants-council-season-9` |

## Sources

- [The Graph Foundation 2025 Annual Grants Report](https://forum.thegraph.com/t/the-graph-foundation-2025-annual-grants-report/6859)
- [Lido Ecosystem Grants Organization Reports](https://research.lido.fi/t/lido-ecosystem-grants-organization-lego-reports/10935)
- [Optimism Season 7 Final Reviewer Nominations](https://gov.optimism.io/t/season-7-nominations-final-reviewer-on-the-grants-council/9402)
- [Polygon CTB Member List Update](https://forum.polygon.technology/t/update-to-ctb-member-list/20909)
- [Optimism Season 9 Governance Fund Missions](https://gov.optimism.io/t/season-9-governance-fund-missions/10526)

## Result

- Programs before: 701
- Programs after: 696
- Semantic review candidates before: 23
- Expected semantic review candidates after: 18
- Related awards, child programs, or funding-system links removed: 0

The remaining queue stays advisory. Records that describe real programs will be renamed or
restructured instead of removed.
