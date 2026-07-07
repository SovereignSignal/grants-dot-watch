#!/usr/bin/env node
// Prepare drafting inputs for synthesis agents.
// - seed/batches/orgs-batch-NN.json: funder orgs, PRIVATE notion block stripped,
//   enriched with per-funder program evidence (award program names, program_profile hits, events).
// - seed/batches/index.json: batch manifest.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'seed');
const load = (f) => JSON.parse(readFileSync(join(SEED, f), 'utf8'));

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const resolved = load('resolved_orgs.json');
const awards = load('awards.json');
const programProfiles = load('program_profiles.json');
const programEvents = load('program_events.json');

// program evidence per funder
const awardProgByFunder = new Map();
for (const a of awards) {
  if (!a.program_name) continue;
  const k = a.funder_norm;
  if (!awardProgByFunder.has(k)) awardProgByFunder.set(k, new Map());
  const m = awardProgByFunder.get(k);
  const e = m.get(a.program_name) || { name: a.program_name, n_awards: 0, sources: new Set() };
  e.n_awards++;
  if (a.source_url) e.sources.add(a.source_url);
  m.set(a.program_name, e);
}

const eventsBySlug = new Map();
for (const e of programEvents) {
  if (!eventsBySlug.has(e.program_slug)) eventsBySlug.set(e.program_slug, []);
  eventsBySlug.get(e.program_slug).push(e);
}

const funders = resolved.filter((o) => o.roles.includes('funder'));
const items = funders.map((o) => {
  const { notion, ...pub } = o; // membrane: CRM context never reaches drafting agents
  const nameN = norm(o.name);
  const progHits = programProfiles
    .filter((p) => {
      const po = norm(p.primary_org || '');
      return (po && (po === nameN || nameN.includes(po) || po.includes(nameN))) ||
             norm(p.program_name).includes(nameN);
    })
    .slice(0, 12)
    .map((p) => ({
      slug: p.program_slug, name: p.program_name, ecosystem: p.ecosystem,
      round_count: p.round_count, known_amounts: p.known_amounts, known_deadlines: p.known_deadlines,
      sources: p.source_names,
      events: (eventsBySlug.get(p.program_slug) || []).slice(0, 6).map((e) => ({
        title: e.event_title, type: e.event_type, status: e.event_status,
        amount: e.amount, deadline: e.deadline, url: e.source_url, seen: e.observed_at,
      })),
    }));
  const awardProgs = [...(awardProgByFunder.get(o.funder_norm) || new Map()).values()]
    .map((e) => ({ name: e.name, n_awards: e.n_awards, sources: [...e.sources].slice(0, 3) }))
    .sort((a, b) => b.n_awards - a.n_awards)
    .slice(0, 10);
  return { ...pub, in_crm: !!notion, program_profile_hits: progHits, award_programs: awardProgs };
});

// evidence-rich first so early batches produce the flagship files
items.sort((a, b) =>
  ((b.awards_stats?.n || 0) + (b.award_programs.length + b.program_profile_hits.length) * 2 + b.entry_count) -
  ((a.awards_stats?.n || 0) + (a.award_programs.length + a.program_profile_hits.length) * 2 + a.entry_count)
);

const SIZE = 20;
mkdirSync(join(SEED, 'batches'), { recursive: true });
const manifest = [];
for (let i = 0; i * SIZE < items.length; i++) {
  const slice = items.slice(i * SIZE, (i + 1) * SIZE);
  const file = `orgs-batch-${String(i + 1).padStart(2, '0')}.json`;
  writeFileSync(join(SEED, 'batches', file), JSON.stringify(slice, null, 1));
  manifest.push({ file, count: slice.length, orgs: slice.map((s) => s.slug) });
}
writeFileSync(join(SEED, 'batches', 'index.json'), JSON.stringify(manifest, null, 1));
console.log(`${items.length} funders -> ${manifest.length} batches of ${SIZE}`);
