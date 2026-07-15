#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'registry');
const jsonOutput = process.argv.includes('--json');

const readYamlDir = (name) =>
  readdirSync(join(ROOT, name))
    .filter((file) => file.endsWith('.yaml'))
    .sort()
    .map((file) => ({ file: `${name}/${file}`, doc: YAML.parse(readFileSync(join(ROOT, name, file), 'utf8')) }));

const orgEntries = readYamlDir('orgs');
const programEntries = readYamlDir('programs');
const systemEntries = readYamlDir('systems');
const orgById = new Map(orgEntries.map(({ doc }) => [doc.id, doc]));

const awardsByProgram = new Map();
const awardsDir = join(ROOT, 'awards');
if (existsSync(awardsDir)) {
  for (const file of readdirSync(awardsDir).filter((name) => name.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(awardsDir, file), 'utf8').split('\n').filter(Boolean)) {
      const award = JSON.parse(line);
      if (award.program) awardsByProgram.set(award.program, (awardsByProgram.get(award.program) || 0) + 1);
    }
  }
}

const childrenByProgram = new Map();
for (const { doc } of programEntries) {
  if (doc.parent) childrenByProgram.set(doc.parent, (childrenByProgram.get(doc.parent) || 0) + 1);
}

const systemsByProgram = new Map();
for (const { doc } of systemEntries) {
  for (const id of doc.funding_channels || []) systemsByProgram.set(id, (systemsByProgram.get(id) || 0) + 1);
}

const semanticRules = [
  ['report', /\b(?:(?:annual|impact|quarterly|q[1-4](?:\s+\d{4})?)\s+)?reports?\b/i, 4],
  ['results-or-award', /\b(?:results?|grant awarded|grants? approved|awards? \$?[\d])/i, 4],
  ['update-or-roundup', /\b(?:updates?|roundups?|reminders?|press releases?|member list)\b/i, 3],
  ['content-artifact', /^(?:source:|blog post:|analysis of|request for feedback)|\b(?:review process|final reviewer|update thread|program thread)\b/i, 3],
  ['announcement', /\b(?:announces?|announcing)\b/i, 2],
];

function refsFor(id) {
  return {
    awards: awardsByProgram.get(id) || 0,
    children: childrenByProgram.get(id) || 0,
    systems: systemsByProgram.get(id) || 0,
  };
}

function inspectProgram(entry) {
  const { doc } = entry;
  const signals = [];
  let score = 0;
  for (const [label, pattern, weight] of semanticRules) {
    if (pattern.test(doc.name || '')) {
      signals.push(label);
      score += weight;
    }
  }

  const rounds = Array.isArray(doc.rounds) ? doc.rounds : [];
  const thin = [];
  if (doc.status === 'unknown') thin.push('unknown-status');
  if (rounds.length === 0) thin.push('no-rounds');
  if (!doc.mechanism) thin.push('no-mechanism');
  if (!(doc.systems || []).length) thin.push('no-systems');
  score += thin.filter((item) => item !== 'no-systems').length;

  if (/dispatch from the wire, no further detail on file/i.test(doc.summary || '')) {
    signals.push('dispatch-placeholder');
    score += 2;
  }

  const org = orgById.get(doc.org);
  if (doc.apply_url && org?.website && doc.apply_url.replace(/\/$/, '') === org.website.replace(/\/$/, '')) {
    signals.push('org-homepage-apply');
    score += 2;
  }

  const refs = refsFor(doc.id);
  return {
    id: doc.id,
    name: doc.name,
    org: doc.org,
    file: entry.file,
    score,
    signals,
    thin,
    refs,
    safe_to_remove: refs.awards === 0 && refs.children === 0 && refs.systems === 0,
    source: doc.sources?.[0] || null,
  };
}

const inspected = programEntries.map(inspectProgram);
const strongSemanticSignals = new Set(['report', 'results-or-award', 'update-or-roundup', 'content-artifact']);
const candidates = inspected
  .filter((item) => item.signals.some((signal) => strongSemanticSignals.has(signal)) && item.score >= 6)
  .sort((a, b) => b.score - a.score || a.org.localeCompare(b.org) || a.name.localeCompare(b.name));

const metric = (predicate) => inspected.filter(predicate).length;
const census = {
  programs: inspected.length,
  unknown_status: metric((item) => item.thin.includes('unknown-status')),
  no_rounds: metric((item) => item.thin.includes('no-rounds')),
  no_mechanism: metric((item) => item.thin.includes('no-mechanism')),
  no_systems: metric((item) => item.thin.includes('no-systems')),
  semantic_candidates: candidates.length,
  unreferenced_semantic_candidates: candidates.filter((item) => item.safe_to_remove).length,
};

if (jsonOutput) {
  console.log(JSON.stringify({ census, candidates }, null, 2));
  process.exit(0);
}

console.log('PROGRAM QUALITY CENSUS');
for (const [key, value] of Object.entries(census)) console.log(`${key}: ${value}`);
console.log('\nSEMANTIC REVIEW QUEUE');
console.log('score\trefs\torg\tid\tsignals');
for (const item of candidates) {
  const refs = item.refs.awards + item.refs.children + item.refs.systems;
  console.log(`${item.score}\t${refs}\t${item.org}\t${item.id}\t${[...item.signals, ...item.thin].join(',')}`);
}
