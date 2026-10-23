#!/usr/bin/env node
// Close open/announced rounds whose deadline is already past.
// Default is a dry run. Pass --write to update registry files in place.
// --ledger-paths <file> names registry paths (one per line, as the Desk ledger
// writes them: registry/programs/...) that an unsynced ledger row targets. Boot
// replay refuses a row whose file changed underneath it, so stale rounds in
// those files are reported and left alone, and the run exits 2.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = process.env.REGISTRY_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', 'registry');
const write = process.argv.includes('--write');
const jsonOutput = process.argv.includes('--json');
const ledgerPathsArg = process.argv.indexOf('--ledger-paths');
const ledgerPaths = new Set(
  ledgerPathsArg === -1
    ? []
    : readFileSync(process.argv[ledgerPathsArg + 1], 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)
);
const PRODUCT_TIME_ZONE = 'America/Los_Angeles';
const calendarDateIn = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
const todayISO = process.env.VALIDATION_TODAY || calendarDateIn(new Date(), PRODUCT_TIME_ZONE);

const isIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isMonthDate = (value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const closeUpperBound = (value) => (isIsoDate(value) ? value : isMonthDate(value) ? `${value}-31` : null);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function closeRoundStatus(raw, roundName, fromStatus) {
  const names = [roundName, `"${roundName}"`, `'${roundName}'`];
  for (const name of names) {
    const pattern = new RegExp(
      `(- name: ${escapeRegExp(name)}\\n(?:[ \\t].*\\n){0,12}?[ \\t]*)(status: ${escapeRegExp(fromStatus)})\\b`
    );
    if (pattern.test(raw)) return raw.replace(pattern, '$1status: closed');
  }
  throw new Error(`could not locate ${fromStatus} status for round "${roundName}"`);
}

const dir = join(ROOT, 'programs');
const changes = [];
const held = [];
for (const file of readdirSync(dir).filter((name) => name.endsWith('.yaml')).sort()) {
  const path = join(dir, file);
  const raw = readFileSync(path, 'utf8');
  const doc = YAML.parse(raw);
  let next = raw;
  for (const round of doc.rounds || []) {
    if (round.status !== 'open' && round.status !== 'announced') continue;
    const bound = closeUpperBound(round.closes);
    if (!bound || bound >= todayISO) continue;
    const change = {
      file: `programs/${file}`,
      id: doc.id,
      program: doc.name,
      round: round.name,
      from: round.status,
      closes: round.closes,
    };
    if (ledgerPaths.has(`registry/programs/${file}`)) {
      held.push(change);
      continue;
    }
    changes.push(change);
    if (write) next = closeRoundStatus(next, round.name, round.status);
  }
  if (write && next !== raw) writeFileSync(path, next);
}

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify({ today: todayISO, write, changes, held }, null, 2)}\n`);
} else if (changes.length) {
  console.log(`${write ? 'Closed' : 'Would close'} ${changes.length} stale round${changes.length === 1 ? '' : 's'} as of ${todayISO}:`);
  for (const change of changes) {
    console.log(`  ${change.file}: "${change.round}" ${change.from} → closed (closes ${change.closes})`);
  }
} else {
  console.log(`OK: no stale live rounds as of ${todayISO}`);
}

if (held.length) {
  console.error(
    `Left ${held.length} stale round${held.length === 1 ? '' : 's'} open: an unsynced Desk ledger row targets ` +
      `${held.length === 1 ? 'its file' : 'their files'}. Sync, deploy and confirm that row before closing:`
  );
  for (const change of held) {
    console.error(`  ${change.file}: "${change.round}" ${change.from} (closes ${change.closes})`);
  }
  process.exitCode = 2;
}
if (!write && !jsonOutput && changes.length) process.exitCode = 2;
