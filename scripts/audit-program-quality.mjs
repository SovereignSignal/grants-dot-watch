#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = process.env.PROGRAM_AUDIT_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', 'registry');
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
  ['applicant-submission', /^(?:grant\s+)?application\b|\bnomination\b/i, 5],
  ['proposal-artifact-title', /\b(?:grant|governance|funding|research) proposal\b|^proposal:/i, 5],
  ['governance-artifact', /\b(?:charter|communication thread)\b/i, 4],
  ['directory-or-map', /\b(?:funding map|funding directory|program directory)\b/i, 5],
  ['retrospective-or-digest', /\b(?:retrospective|weekly digest)\b/i, 5],
  ['cohort-announcement', /\b(?:organizations announced|funding announcement|meet the new .+ fellows)\b/i, 5],
  ['single-award-story', /\b(?:grant to|receives? .{0,40}\bgrant|awards? .{0,40}\bgrant to|invests? .{0,40}\bgrant to|funding package .{0,20}\bfor|secures? funding)\b/i, 5],
  ['partnership-story', /\bpartners? with\b/i, 5],
  ['umbrella-announcement', /\bannounces? grant programs?\b/i, 5],
  ['announcement', /\b(?:announces?|announcing)\b/i, 2],
];

const sourceSemanticRules = [
  ['applicant-submission', /\/t\/(?:grant-application|application-|nomination-)/i, 5],
  ['applicant-submission', /\/t\/grant-proposal-/i, 5],
  ['help-request', /\/t\/(?:how-can-i|how-do-i|help-|question-)/i, 5],
  ['unsupported-placeholder', /https?:\/\/manual\/needs-source\//i, 6],
];

const summarySemanticRules = [
  ['proposal-artifact', /^(?:i[’']?m|i am|we are) proposing\b|\bthis proposal (?:is submitted|outlines|requests?|introduces|proposes)\b|\bwe propose that .{0,80}\bfund\b/i, 5],
  ['applicant-feedback', /\bi am preparing an expression of interest\b|\brequest for feedback on .{0,40}\b(?:eoi|proposal|application)\b/i, 5],
  ['participant-funded-program', /\bprogram fee\b|\bpay in cash or equity\b/i, 5],
  ['prompt-leak', /\b(?:the prompt says|must include|should we include|so start with|we can say|didn[’']t specify eligibility|need to lead with|must be max \d+ words|not required in (?:the )?summary|provide plain prose|under \d+ words|let[’']?s craft|no amount given|just include (?:the )?source)\b/i, 6],
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

  const sourceText = (doc.sources || []).join('\n');
  for (const [label, pattern, weight] of sourceSemanticRules) {
    if (pattern.test(sourceText)) {
      if (!signals.includes(label)) signals.push(label);
      score += weight;
    }
  }

  for (const [label, pattern, weight] of summarySemanticRules) {
    if (pattern.test((doc.summary || '').trim())) {
      signals.push(label);
      score += weight;
    }
  }

  const summary = (doc.summary || '').trim();
  if (summary.length >= 180 && /[a-z]{1,3}$/.test(summary)) {
    signals.push('summary-truncated');
    score += 6;
  }

  const rounds = Array.isArray(doc.rounds) ? doc.rounds : [];
  if (doc.status === 'unknown' && !doc.mechanism && rounds.length === 0 && /\/t\/(?:[^/]*-)?(?:proposal|grant-request|funding-request|budget-request|temperature-check|temp-check)(?:-|\/)/i.test(sourceText)) {
    signals.push('forum-proposal-source');
    score += 5;
  }
  const thin = [];
  if (doc.status === 'unknown') thin.push('unknown-status');
  if (rounds.length === 0) thin.push('no-rounds');
  if (!doc.mechanism) thin.push('no-mechanism');
  if (!(doc.systems || []).length) thin.push('no-systems');
  score += thin.filter((item) => item !== 'no-systems').length;

  if (/dispatch from the wire, no further detail on file/i.test(doc.summary || '')) {
    signals.push('dispatch-placeholder');
    score += 6;
  }

  const org = orgById.get(doc.org);
  if (doc.apply_url && org?.website && doc.apply_url.replace(/\/$/, '') === org.website.replace(/\/$/, '')) {
    signals.push('org-homepage-apply');
    score += 2;
    const pathname = new URL(doc.apply_url).pathname.replace(/\/$/, '');
    if (!pathname && doc.status === 'unknown' && !doc.mechanism && rounds.length === 0) {
      signals.push('homepage-only-apply');
      score += 5;
    }
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
const strongSemanticSignals = new Set([
  'report',
  'results-or-award',
  'update-or-roundup',
  'content-artifact',
  'applicant-submission',
  'proposal-artifact-title',
  'governance-artifact',
  'directory-or-map',
  'retrospective-or-digest',
  'cohort-announcement',
  'single-award-story',
  'partnership-story',
  'umbrella-announcement',
  'help-request',
  'unsupported-placeholder',
  'proposal-artifact',
  'applicant-feedback',
  'participant-funded-program',
  'prompt-leak',
  'dispatch-placeholder',
  'homepage-only-apply',
  'summary-truncated',
  'forum-proposal-source',
]);
const candidates = inspected
  // A strong semantic rule is independently review-worthy. Thinness is useful
  // context and ranking weight, never a prerequisite that lets a polished
  // non-program artifact evade the queue.
  .filter((item) => item.signals.some((signal) => strongSemanticSignals.has(signal)))
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
  process.stdout.write(`${JSON.stringify({ census, candidates }, null, 2)}\n`);
} else {
  console.log('PROGRAM QUALITY CENSUS');
  for (const [key, value] of Object.entries(census)) console.log(`${key}: ${value}`);
  console.log('\nSEMANTIC REVIEW QUEUE');
  console.log('score\trefs\torg\tid\tsignals');
  for (const item of candidates) {
    const refs = item.refs.awards + item.refs.children + item.refs.systems;
    console.log(`${item.score}\t${refs}\t${item.org}\t${item.id}\t${[...item.signals, ...item.thin].join(',')}`);
  }
}
