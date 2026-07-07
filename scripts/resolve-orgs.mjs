#!/usr/bin/env node
// Deterministic entity resolution across seed sources -> seed/resolved_orgs.json
// Join keys: website domain (strong), normalized full name (exact). No fuzzy auto-merges:
// near-misses land in seed/resolution_report.json as merge candidates for the judgment queue.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed');
const load = (f) => JSON.parse(readFileSync(join(SEED, f), 'utf8')) || [];

const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const domain = (url) => {
  if (!url) return null;
  try {
    const h = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return h.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
};

const slugify = (s) =>
  norm(s).replace(/ /g, '-').replace(/-+/g, '-').slice(0, 60).replace(/^-|-$/g, '');

const orgs = new Map(); // slug -> record
const byName = new Map(); // norm(name) -> slug
const byDomain = new Map(); // domain -> slug
const report = { merge_candidates: [], unmatched: {} };

function findOrg(name, url) {
  const d = domain(url);
  if (d && byDomain.has(d)) return orgs.get(byDomain.get(d));
  const n = norm(name);
  if (n && byName.has(n)) return orgs.get(byName.get(n));
  return null;
}

function register(rec) {
  orgs.set(rec.slug, rec);
  for (const n of rec.names_seen) if (!byName.has(norm(n))) byName.set(norm(n), rec.slug);
  for (const d of rec.domains) if (d && !byDomain.has(d)) byDomain.set(d, rec.slug);
  return rec;
}

function addName(rec, name) {
  if (name && !rec.names_seen.some((x) => norm(x) === norm(name))) {
    rec.names_seen.push(name);
    if (!byName.has(norm(name))) byName.set(norm(name), rec.slug);
  }
}

function addDomain(rec, url) {
  const d = domain(url);
  if (!d) return;
  if (byDomain.has(d) && byDomain.get(d) !== rec.slug) {
    report.merge_candidates.push({ domain: d, a: byDomain.get(d), b: rec.slug });
    return;
  }
  if (!rec.domains.includes(d)) {
    rec.domains.push(d);
    byDomain.set(d, rec.slug);
  }
}

// 1) org_profiles is the base (it was the curated landscape map)
for (const o of load('org_profiles.json')) {
  const rec = register({
    slug: o.slug || slugify(o.name),
    name: o.name,
    names_seen: [o.name],
    domains: [],
    website: o.website || null,
    twitter: o.twitter || null,
    github: o.github_url || null,
    org_type: o.org_type || null,
    wires: (o.wires || []).map((w) => w.toLowerCase()),
    description: o.description || null,
    entry_count: o.entry_count || 0,
    sources: { org_profiles: true },
    surfaces: {},
    forums: [],
    funding: {},
    awards_stats: null,
    notion: null, // PRIVATE context — never into registry/ prose
    roles: [],
  });
  addDomain(rec, o.website);
}

// 2) funder_profiles
for (const f of load('funder_profiles.json')) {
  let rec = findOrg(f.funder_name, f.homepage);
  if (!rec) {
    rec = register({
      slug: slugify(f.funder_name), name: f.funder_name, names_seen: [f.funder_name],
      domains: [], website: f.homepage || null, twitter: null, github: null,
      org_type: null, wires: f.wire ? [f.wire.toLowerCase()] : [], description: null,
      entry_count: 0, sources: {}, surfaces: {}, forums: [], funding: {}, awards_stats: null,
      notion: null, roles: [],
    });
  }
  rec.sources.funder_profiles = true;
  rec.funder_norm = f.funder_norm;
  rec.funding = {
    focus: f.focus_areas || [], typical_size: f.typical_grant_size || null,
    cadence: f.cadence || null, deadlines: f.deadlines || null,
    eligibility: f.eligibility || null, apply_url: f.apply_url || null,
    description: f.description || null,
  };
  addName(rec, f.funder_name);
  addDomain(rec, f.homepage);
  if (!rec.website && f.homepage) rec.website = f.homepage;
}

// 3) funder_stats (awards evidence)
for (const s of load('funder_stats.json')) {
  let rec = [...orgs.values()].find((r) => r.funder_norm === s.funder_norm) || findOrg(s.funder_name, null);
  if (!rec) {
    rec = register({
      slug: slugify(s.funder_name), name: s.funder_name, names_seen: [s.funder_name],
      domains: [], website: null, twitter: null, github: null, org_type: null,
      wires: (s.wires || []).map((w) => (w || '').toLowerCase()).filter(Boolean),
      description: null, entry_count: 0, sources: {}, surfaces: {}, forums: [],
      funding: {}, awards_stats: null, notion: null, roles: [],
    });
  }
  rec.sources.awards = true;
  rec.funder_norm = rec.funder_norm || s.funder_norm;
  rec.awards_stats = {
    n: +s.n_awards, total_usd: s.total_usd ? +s.total_usd : null,
    first: s.first_award, last: s.last_award,
  };
}

// 4) notion orgs (private CRM context + identity enrichment)
for (const n of load('notion_orgs.json')) {
  let rec = findOrg(n.name, n.website);
  if (!rec) {
    rec = register({
      slug: slugify(n.name), name: n.name, names_seen: [n.name], domains: [],
      website: n.website || null, twitter: null, github: null, org_type: n.type || null,
      wires: (Array.isArray(n.wire) ? n.wire : (n.wire || '').split(',')).map((w) => norm(w)).filter(Boolean),
      description: null, entry_count: 0, sources: {}, surfaces: {}, forums: [],
      funding: {}, awards_stats: null, notion: null, roles: [],
    });
  }
  rec.sources.notion = true;
  rec.notion = { page_id: n.page_id || null, relationship: n.relationship || null, tier: n.tier || null, quality: n.quality_score || null };
  addName(rec, n.name);
  addDomain(rec, n.website);
  if (!rec.website && n.website) rec.website = n.website;
  if (!rec.org_type && n.type) rec.org_type = n.type;
}

// 5) watch surfaces grouped by org_name
for (const w of load('watch_surfaces.json')) {
  const rec = findOrg(w.org_name, null) || findOrg(w.org_name, w.url);
  if (!rec) {
    report.unmatched.watch_surfaces = (report.unmatched.watch_surfaces || 0) + 1;
    continue;
  }
  rec.sources.watch_surfaces = true;
  if (w.surface_type && w.url && !rec.surfaces[w.surface_type]) rec.surfaces[w.surface_type] = w.url;
}

// 6) discuss.watch forums — conservative: domain-root or exact-name containment
const forums = load('discuss_forums.json');
for (const f of forums) {
  const fd = domain(f.url);
  for (const rec of orgs.values()) {
    const nameHit = norm(f.name).startsWith(norm(rec.name)) && norm(rec.name).length > 4;
    const domHit = fd && rec.domains.some((d) => fd.endsWith(d.split('.').slice(-2).join('.')));
    if (nameHit || domHit) {
      rec.forums.push({ name: f.name, url: f.url, vertical: f.vertical });
      break;
    }
  }
}

// 7) roles
const granteeNorms = new Set(load('grantee_profiles.json').map((g) => norm(g.grantee_name)));
for (const rec of orgs.values()) {
  const isFunder = !!(rec.awards_stats || rec.sources.funder_profiles ||
    rec.notion?.relationship === 'Active Grantmaker' || rec.notion?.relationship === 'BD Target');
  const isGrantee = granteeNorms.has(norm(rec.name));
  rec.roles = [...(isFunder ? ['funder'] : []), ...(isGrantee ? ['grantee'] : [])];
  if (!rec.roles.length) rec.roles = ['ecosystem'];
}

const out = [...orgs.values()].sort((a, b) => a.slug.localeCompare(b.slug));
writeFileSync(join(SEED, 'resolved_orgs.json'), JSON.stringify(out, null, 1));
writeFileSync(join(SEED, 'resolution_report.json'), JSON.stringify(report, null, 1));
const funders = out.filter((o) => o.roles.includes('funder'));
console.log(`orgs: ${out.length} | funders: ${funders.length} | merge candidates: ${report.merge_candidates.length} | unmatched surfaces: ${report.unmatched.watch_surfaces || 0}`);
