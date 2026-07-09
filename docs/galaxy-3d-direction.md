# Galaxy v2: 3D relational map (Sov, 2026-07-09)

Reference: https://mapofzones.com/home?columnKey=ibcVolume&period=24h — ideally a 3D model.
Verdict on current 2D galaxy: "cluttered and not valuable" — because it shows positions without RELATIONSHIPS.

Direction:
- 3D WebGL force graph (lib: `3d-force-graph` / three.js), orbit+zoom, dark observatory bg.
- Nodes = orgs; size = funding activity (awards count/USD); color = wire hue; glow/ring = live round.
- Edges = the value: co-funding links between funders (shared grantees, weight = overlap), optional funder→top-grantee edges at zoom, system membership as cluster gravity (invisible links or hulls).
- Systems as labeled anchor regions (like zones' hubs). Hover tooltip; click → /orgs/[id]. Filters: wire, live-only, system.
- Keep 2D field as home hero ambience; /galaxy becomes the 3D model. Performance target 60fps @ ~500 nodes/2k edges.

DECISION (Sov, 2026-07-09): if the 3D galaxy looks great, it TAKES THE HERO on home too — current 2D field hero rated "not that great". Build 3D first, then replace hero with an embedded/teaser view of it.

## Graph v2 spec (data-grounded, 2026-07-09)
Direct co-funding is sparse in the ledger (34 pairs even at >=1 shared grantee). The web comes from FLOWS:
- Nodes: 230 funders (sized by activity) + 66 multi-funder grantees (the bridges, medium, distinct shape/tone) + top ~150 single-funder grantees by USD (small, dim satellites) ≈ 450 nodes.
- Edges: funder→grantee award edges (weight = award count/USD; ~500-600 shown) + the 34 co-funding accent links (brighter) + system hub links (structure, near-invisible).
- Result: funders connect THROUGH shared grantees — the truthful version of mapofzones' zones-and-channels.
