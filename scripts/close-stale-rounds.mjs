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
// Keep this block identical to scripts/validate-registry.mjs (tests check the
// two agree). Desk staging copies that file alone, so it cannot import it.
// A deadline is closes_at when given; otherwise the end of the closes day (or
// month) Anywhere on Earth. A live round fails 6 hours after its deadline.
const DEADLINE_GRACE_MS = 6 * 60 * 60 * 1000;
const AOE_OFFSET_MS = 12 * 60 * 60 * 1000;
const endOfDayIn = (dayISO, timeZone) => {
  const [y, m, d] = dayISO.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d + 1) - 14 * 60 * 60 * 1000;
  while (calendarDateIn(new Date(t), timeZone) <= dayISO) t += 15 * 60 * 1000;
  return t - 1;
};
const roundDeadlineMs = (round) => {
  const at = typeof round.closes_at === 'string' ? round.closes_at.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(at)) {
    const ms = Date.parse(at);
    if (Number.isFinite(ms)) return ms;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(at)) {
    const ms = Date.parse(`${at}Z`);
    if (Number.isFinite(ms)) return ms + AOE_OFFSET_MS;
  }
  const closes = typeof round.closes === 'string' ? round.closes : '';
  let match = closes.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return Date.UTC(+match[1], +match[2] - 1, +match[3] + 1) + AOE_OFFSET_MS;
  match = closes.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (match) return Date.UTC(+match[1], +match[2], 1) + AOE_OFFSET_MS;
  return null;
};
const isPastDeadline = (round, now) => {
  const deadline = roundDeadlineMs(round);
  return deadline != null && now > deadline + DEADLINE_GRACE_MS;
};
// VALIDATION_NOW pins the instant. VALIDATION_TODAY replays the end of a past
// or future product day; set to today it means now.
const resolveNowMs = () => {
  if (process.env.VALIDATION_NOW) {
    const ms = Date.parse(process.env.VALIDATION_NOW);
    if (!Number.isFinite(ms)) throw new Error(`VALIDATION_NOW is not a timestamp: ${process.env.VALIDATION_NOW}`);
    return ms;
  }
  const replay = process.env.VALIDATION_TODAY;
  if (replay && replay !== calendarDateIn(new Date(), PRODUCT_TIME_ZONE)) return endOfDayIn(replay, PRODUCT_TIME_ZONE);
  return Date.now();
};
const nowMs = resolveNowMs();
const todayISO = process.env.VALIDATION_TODAY || calendarDateIn(new Date(nowMs), PRODUCT_TIME_ZONE);
const nowStamp = new Date(nowMs).toISOString();

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
    if (!isPastDeadline(round, nowMs)) continue;
    const deadline = roundDeadlineMs(round);
    const change = {
      file: `programs/${file}`,
      id: doc.id,
      program: doc.name,
      round: round.name,
      from: round.status,
      closes: round.closes,
      deadline: new Date(deadline).toISOString(),
      basis: round.closes_at ? 'closes_at' : 'end of day AoE',
      cutoff: new Date(deadline + DEADLINE_GRACE_MS).toISOString(),
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
  process.stdout.write(`${JSON.stringify({ today: todayISO, now: nowStamp, write, changes, held }, null, 2)}\n`);
} else if (changes.length) {
  console.log(`${write ? 'Closed' : 'Would close'} ${changes.length} stale round${changes.length === 1 ? '' : 's'} as of ${nowStamp}:`);
  for (const change of changes) {
    console.log(
      `  ${change.file}: "${change.round}" ${change.from} → closed (closes ${change.closes}; ` +
        `deadline ${change.deadline} by ${change.basis}, closable after ${change.cutoff})`
    );
  }
} else {
  console.log(`OK: no stale live rounds as of ${nowStamp}`);
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
