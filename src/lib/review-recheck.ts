// Daily review recheck (DESK_UPKEEP_ENABLED=1 and REVIEW_RECHECK_ENABLED=1).
// The daily ingest run calls runReviewRecheck right after Desk upkeep, inside
// the same lock and once-per-day claim. It re-fetches the official page of
// each program whose review is expired or due within REVIEW_HORIZON_DAYS, and:
// - renews the review dates through decideProposal, as a machine decision with
//   an audit, when the page still names the program and supports the recorded
//   intake (the rule is REVIEW_RECHECK_POLICY in machine-approval-policy.ts);
// - queues anything else as a pending Desk item with its reason;
// - stamps nothing and queues nothing when the fetch fails.
// Ported from scripts/research/recheck.mjs (b8a4197), which proposed every
// renewal for owner approval; here only the date-only renewal applies itself.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { buildProposalChanges } from './committer';
import { fetchEvidencePage, hostMatchesRegisteredDomain, registeredDomain, type PageFetch } from './curator-auto-apply';
import { decideProposal, proposalChangeHash } from './desk-decide';
import { insertIngestProposals, listProposals, type RawMinerProposal } from './desk-store';
import { REVIEW_RECHECK_POLICY, reviewRecheckEnabled } from './machine-approval-policy';
import { REVIEW_HORIZON_DAYS, reviewDueState, reviewRenewalBlocker, shiftDay } from './program-review';
import { normalizeForMatch, pageContainsDate, STATUS_EVIDENCE_PHRASES } from './proposal-validator';
import { loadRegistry } from './registry';
import { productDateISO } from './round-state';
import type { Org, Program, ProgramReview, Proposal, ReviewRecheckAutoApply } from './types';
import { CLOSED_PHRASES, OPEN_PHRASES } from './wire-program-auto-apply';

/** Page fetches per daily run. */
export const MAX_REVIEW_RECHECKS = 30;
/** A renewed review is due again this many days after its check. It must exceed
 *  REVIEW_HORIZON_DAYS, or a renewal is due again the day it lands. */
export const REVIEW_RENEW_DAYS = 30;
const SIGNAL_PREFIX = 'recheck:';
const ROLLING_PHRASES = ['rolling basis', 'rolling applications'];
const LIVE_ROUND = new Set(['open', 'announced']);

export type RecheckQueueKind =
  | 'closure'
  | 'intake_change'
  | 'name_missing'
  | 'intake_not_confirmed'
  | 'round_not_current'
  | 'deadline_not_on_page'
  | 'off_domain'
  | 'shared_host'
  | 'wider_change'
  | 'apply_failed';

export interface ReviewRecheckSummary {
  at: string;
  policy: string;
  /** Programs whose review is expired or due within the horizon. */
  due: number;
  /** Pages fetched this run. */
  fetched: number;
  renewed: { program_id: string; proposal_id: string; review_after: string; final_url: string }[];
  queued: { program_id: string; proposal_id: string | null; kind: RecheckQueueKind; reason: string }[];
  /** Fetch failures. Nothing stamped, nothing queued. */
  failed: { program_id: string; reason: string }[];
  skipped: { program_id: string; reason: string }[];
  halted?: string;
  errors: string[];
}

export interface ReviewRecheckDeps {
  env?: NodeJS.ProcessEnv;
  registry?: () => { orgs: Org[]; programs: Program[] };
  /** The program file's text as on disk, or null when it is missing. */
  readProgram?: (id: string) => string | null;
  /** Every proposal on file (any state). */
  listAll?: () => Promise<Proposal[]>;
  /** Insert one pending proposal; null when the store already holds it. */
  queue?: (raw: RawMinerProposal) => Promise<Proposal | null>;
  fetchPage?: (url: string, allowedDomain: string) => Promise<PageFetch>;
  /** The program document the committer would write for this proposal, or
   *  null when it would write anything other than that one program file. */
  preview?: (proposal: Proposal, id: string) => unknown;
  decide?: typeof decideProposal;
  now?: () => Date;
  yieldTurn?: () => Promise<void>;
  maxFetches?: number;
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 200);

function readProgramFile(id: string): string | null {
  try {
    return readFileSync(join(process.cwd(), 'registry', 'programs', `${id}.yaml`), 'utf8');
  } catch {
    return null;
  }
}

/** Dry-runs the committer (no writes) and returns the program it would write. */
export function previewProgramWrite(proposal: Proposal, id: string): unknown {
  const yaml = buildProposalChanges(proposal).changes.filter((change) => change.path.endsWith('.yaml'));
  if (yaml.length !== 1 || yaml[0].path !== `registry/programs/${id}.yaml`) return null;
  return YAML.parse(yaml[0].content);
}

async function queueOne(raw: RawMinerProposal): Promise<Proposal | null> {
  const { inserted } = await insertIngestProposals([raw]);
  return inserted[0] ?? null;
}

/** The domain a review source may be fetched on: the org's website domain, or
 *  the program's apply_url domain. Shared hosts are no domain. */
export function reviewSourceDomain(
  source: string,
  program: Pick<Program, 'apply_url'>,
  org: Pick<Org, 'website'> | undefined
): { domain: string } | { refused: 'off_domain' | 'shared_host' } {
  const candidates = [registeredDomain(org?.website), registeredDomain(program.apply_url)].filter((d): d is string => Boolean(d));
  const domain = candidates.find((d) => hostMatchesRegisteredDomain(source, d));
  if (domain) return { domain };
  let sourceHost: string | null = null;
  try {
    sourceHost = new URL(source).hostname;
  } catch {
    sourceHost = null;
  }
  return { refused: sourceHost && registeredDomain(`https://${sourceHost}`) === null ? 'shared_host' : 'off_domain' };
}

export type IntakeReading =
  | { state: 'supports'; phrase: string }
  | { state: 'contradicts'; intake: 'open' | 'closed'; phrase: string }
  | { state: 'unclear' };

/**
 * Whether the page text supports the recorded intake. Conservative, after
 * recheck.mjs: the supporting phrases are proposal-validator.ts's status
 * evidence (open: applications open, apply now, accepting applications, ...;
 * closed: applications closed, deadline has passed, ...), plus "rolling basis"
 * and "rolling applications" for a rolling open review. The vetoes are the
 * wider wire-program lists: any closed phrase there defeats an open reading,
 * any open phrase there defeats a closed one. Postponed and unknown intake are
 * never supported. A page that clearly says the other thing contradicts.
 */
export function reviewIntakeSupport(body: string, review: Pick<ProgramReview, 'intake' | 'intake_mode'>): IntakeReading {
  const text = ` ${normalizeForMatch(body)} `;
  const has = (phrase: string) => text.includes(` ${phrase} `);
  const strongOpen = STATUS_EVIDENCE_PHRASES.open.find(has) ?? null;
  const rollingOpen = review.intake_mode === 'rolling' ? ROLLING_PHRASES.find(has) ?? null : null;
  const strongClosed = STATUS_EVIDENCE_PHRASES.closed.find(has) ?? null;
  const anyOpen = OPEN_PHRASES.find(has) ?? null;
  const anyClosed = CLOSED_PHRASES.find(has) ?? null;
  const open = strongOpen ?? rollingOpen;
  if (review.intake === 'open') {
    if (open && !anyClosed) return { state: 'supports', phrase: open };
    if (strongClosed && !anyOpen) return { state: 'contradicts', intake: 'closed', phrase: strongClosed };
    return { state: 'unclear' };
  }
  if (review.intake === 'closed') {
    if (strongClosed && !anyOpen) return { state: 'supports', phrase: strongClosed };
    if (open && !anyClosed) return { state: 'contradicts', intake: 'open', phrase: open };
    return { state: 'unclear' };
  }
  // Postponed or unknown: a clear page is an intake change for the owner.
  if (open && !anyClosed) return { state: 'contradicts', intake: 'open', phrase: open };
  if (strongClosed && !anyOpen) return { state: 'contradicts', intake: 'closed', phrase: strongClosed };
  return { state: 'unclear' };
}

/** Rounds an open review names must still be live, and each closing date must
 *  be on the page with its year: a renewed review re-notes those deadlines. */
function namedRoundProblem(program: Program, body: string, today: string): 'round_not_current' | 'deadline_not_on_page' | null {
  const names = program.review?.round_names || [];
  for (const name of names) {
    const round = (program.rounds || []).find((r) => r.name === name);
    if (!round || !LIVE_ROUND.has(round.status) || (round.closes && round.closes < today)) return 'round_not_current';
    if (round.closes && !pageContainsDate(body, round.closes)) return 'deadline_not_on_page';
  }
  return null;
}

/** The renewed review: the recorded block with only the two dates moved. */
export function renewedReview(review: ProgramReview, today: string, renewDays = REVIEW_RENEW_DAYS): ProgramReview {
  return { ...review, checked_on: today, review_after: shiftDay(today, renewDays) };
}

const DATE_FIELDS = new Set(['checked_on', 'review_after']);

/** True when `after` differs from `before` only in review.checked_on and
 *  review.review_after. Both are whole program documents. A top-level field
 *  that is blank on either side (null or "") counts as absent: the committer
 *  writes `apply_url: ""` as no apply_url and an absent parent as null, and
 *  neither carries a value. Key order is ignored. */
export function onlyReviewDatesChanged(before: unknown, after: unknown): boolean {
  const canon = (value: unknown) => JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])) : v);
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return false;
  const b = before as Record<string, unknown>, a = after as Record<string, unknown>;
  const strip = (doc: Record<string, unknown>) => {
    const review = doc.review && typeof doc.review === 'object' ? { ...(doc.review as Record<string, unknown>) } : doc.review;
    if (review && typeof review === 'object') for (const key of DATE_FIELDS) delete (review as Record<string, unknown>)[key];
    const kept = Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== null && value !== undefined && value !== ''));
    return { ...kept, review };
  };
  return Boolean(b.review && a.review) && canon(strip(b)) === canon(strip(a));
}

function renewalChange(id: string, review: ProgramReview, fileHash: string): Record<string, unknown> {
  const path = `programs/${id}.yaml`;
  return { [path]: { review }, _expected_content_hashes: { [path]: fileHash } };
}

const QUEUE_TITLE: Record<RecheckQueueKind, string> = {
  closure: 'official page now says applications are closed',
  intake_change: 'official page now states a different intake',
  name_missing: 'review renewal needs a look: the program name is not on the page',
  intake_not_confirmed: 'review renewal needs a look: the page does not confirm the recorded intake',
  round_not_current: 'review renewal needs a look: a reviewed round is no longer current',
  deadline_not_on_page: 'review renewal needs a look: a reviewed deadline is not on the page',
  off_domain: 'review renewal needs a look: the source is not on the org’s own site',
  shared_host: 'review renewal needs a look: the source is on a shared host',
  wider_change: 'review renewal needs a look: the write would also normalize other fields',
  apply_failed: 'review renewal could not apply automatically',
};

/** One pass. Returns null and touches nothing while either flag is off. */
export async function runReviewRecheck(deps: ReviewRecheckDeps = {}): Promise<ReviewRecheckSummary | null> {
  if (!reviewRecheckEnabled(deps.env ?? process.env)) return null;
  const registry = deps.registry ?? (() => loadRegistry());
  const readProgram = deps.readProgram ?? readProgramFile;
  const listAll = deps.listAll ?? (() => listProposals(undefined, { recoverClaims: false }));
  const queue = deps.queue ?? queueOne;
  const fetchPage = deps.fetchPage ?? ((url: string, domain: string) => fetchEvidencePage(url, domain));
  const preview = deps.preview ?? previewProgramWrite;
  const decide = deps.decide ?? decideProposal;
  const now = deps.now ?? (() => new Date());
  const pause = deps.yieldTurn ?? turn;
  const cap = deps.maxFetches ?? MAX_REVIEW_RECHECKS;

  const today = productDateISO(now());
  const summary: ReviewRecheckSummary = {
    at: now().toISOString(), policy: REVIEW_RECHECK_POLICY, due: 0, fetched: 0,
    renewed: [], queued: [], failed: [], skipped: [], errors: [],
  };
  const { orgs, programs } = registry();
  const due = programs
    .filter((p) => p.review && ['expired', 'due'].includes(reviewDueState(p, today, REVIEW_HORIZON_DAYS)))
    .sort((a, b) => a.review!.review_after.localeCompare(b.review!.review_after) || a.id.localeCompare(b.id));
  summary.due = due.length;
  if (!due.length) return summary;

  let existing: Proposal[] = [];
  try {
    existing = (await listAll()).filter((p) => typeof p.signal_id === 'string' && p.signal_id.startsWith(SIGNAL_PREFIX));
  } catch (error) {
    summary.errors.push(`queue: ${message(error)}`);
    return summary;
  }

  let first = true;
  for (const listed of due) {
    const skip = (reason: string) => summary.skipped.push({ program_id: listed.id, reason });
    if (summary.halted) {
      skip(summary.halted);
      continue;
    }
    const blocker = reviewRenewalBlocker(listed);
    if (blocker) {
      skip(blocker);
      continue;
    }
    if (listed.review!.operating !== listed.status) {
      skip('status_drift');
      continue;
    }
    // One open question per review: a pending item waits for the owner, and an
    // owner rejection stands until the review itself changes. A machine expiry
    // (an `auto:` note) does not count as the owner's answer.
    const scope = `${SIGNAL_PREFIX}${listed.id}:${listed.review!.review_after}:`;
    const earlier = existing.filter((p) => String(p.signal_id).startsWith(scope));
    if (earlier.some((p) => p.state === 'pending' || p.state === 'applying')) {
      skip('already_queued');
      continue;
    }
    if (earlier.some((p) => p.state === 'rejected' && !(p.decision_note || '').startsWith('auto:'))) {
      skip('owner_rejected');
      continue;
    }

    if (!first) await pause();
    first = false;
    try {
      // Everything below reads the file itself, so the hash, the renewal and
      // the "only the dates changed" check all describe the same bytes.
      const text = readProgram(listed.id);
      if (text === null) {
        skip('program_file_missing');
        continue;
      }
      const fileHash = createHash('sha256').update(text).digest('hex');
      const doc = YAML.parse(text) as Program;
      const review = doc?.review;
      if (!review || review.review_after !== listed.review!.review_after) {
        skip('registry_changed');
        continue;
      }
      const program = { ...doc, rounds: doc.rounds || [] } as Program;
      const org = orgs.find((o) => o.id === program.org);
      const renewal = renewedReview(review, today);
      const signal = (kind: string) => `${scope}${kind}:${today}`;
      const queueItem = async (kind: RecheckQueueKind, reason: string, next: ProgramReview, evidence: string) => {
        const change = renewalChange(program.id, next, fileHash);
        const raw: RawMinerProposal = {
          type: 'profile_note', org: program.org, program: program.name,
          title: `${program.name}: ${QUEUE_TITLE[kind]}`,
          summary: `Review due ${review.review_after}. ${reason} ${evidence} Approving sets the review's intake to ${next.intake}, checked_on to ${next.checked_on} and review_after to ${next.review_after}. Reject to leave the review aged.`,
          evidence_url: review.source, proposed_change: change, signal_id: signal(kind), wire: program.wires?.[0] ?? null,
        };
        const queued = await queue(raw);
        summary.queued.push({ program_id: program.id, proposal_id: queued?.id ?? null, kind, reason });
      };

      const where = reviewSourceDomain(review.source, program, org);
      if ('refused' in where) {
        await queueItem(where.refused, where.refused === 'shared_host'
          ? `The review source ${review.source} sits on a shared host, which is no organization's domain, so the daily recheck cannot vouch for it.`
          : `The review source ${review.source} is not on the org's or program's own domain, so the daily recheck cannot vouch for it.`,
        renewal, 'The page was not fetched.');
        continue;
      }
      if (summary.fetched >= cap) {
        skip('over_cap');
        continue;
      }
      let page: PageFetch;
      try {
        page = await fetchPage(review.source, where.domain);
      } catch {
        page = { ok: false, reason: 'fetch_failed' };
      }
      summary.fetched += 1;
      if (!page.ok) {
        summary.failed.push({ program_id: program.id, reason: 'fetch_failed' });
        continue;
      }
      const evidence = `Fetched ${page.url} on ${today}, page sha256 ${page.hash.slice(0, 12)}.`;
      if (!hostMatchesRegisteredDomain(page.url, where.domain)) {
        await queueItem('off_domain', `The review source answered from ${page.url}, outside ${where.domain}.`, renewal, evidence);
        continue;
      }
      const name = normalizeForMatch(program.name);
      if (!name || !` ${normalizeForMatch(page.body)} `.includes(` ${name} `)) {
        await queueItem('name_missing', `The page no longer names ${program.name}; a removed page often still answers 200 with its navigation intact.`, renewal, evidence);
        continue;
      }
      const reading = reviewIntakeSupport(page.body, review);
      if (reading.state === 'contradicts') {
        // The program is active (reviewRenewalBlocker), so an open intake validates.
        const kind: RecheckQueueKind = review.intake === 'open' && reading.intake === 'closed' ? 'closure' : 'intake_change';
        const next: ProgramReview = {
          ...renewal,
          intake: reading.intake,
          intake_note: `Official page re-fetched ${today} says "${reading.phrase}" (page sha256 ${page.hash.slice(0, 12)}). Previously recorded ${review.intake}: ${review.intake_note}`.slice(0, 4000),
        };
        await queueItem(kind, `The review records intake ${review.intake}; the page now says "${reading.phrase}".`, next, evidence);
        continue;
      }
      if (reading.state === 'unclear') {
        await queueItem('intake_not_confirmed', `The page does not confirm the recorded ${review.intake} intake: it states neither clearly, or states both.`, renewal, evidence);
        continue;
      }
      if (review.intake === 'open') {
        const problem = namedRoundProblem(program, page.body, today);
        if (problem) {
          await queueItem(problem, problem === 'round_not_current'
            ? `The review is scoped to ${review.round_names!.join(', ')}, and a named round is closed or past its date.`
            : `The review is scoped to ${review.round_names!.join(', ')}, and a named round's closing date is not on the page with its year.`,
          renewal, evidence);
          continue;
        }
      }

      // Supported: renew only the two dates, and prove that is all that moves.
      // The committer rewrites the whole file, so ask it (a dry run, no
      // writes) what it would write, and compare that to the bytes read.
      const change = renewalChange(program.id, renewal, fileHash);
      const draft = { id: 'recheck-preview', type: 'profile_note', org: program.org, program: program.name, title: program.name, summary: program.name,
        evidence_url: review.source, proposed_change: change, signal_id: signal('renewal'), lane: 'judgment', state: 'pending', created_at: now().toISOString() } as Proposal;
      if (!onlyReviewDatesChanged(doc, preview(draft, program.id))) {
        await queueItem('wider_change', `The page supports the review, but writing the renewal would also change fields other than the review dates (the committer normalizes this file).`, renewal, evidence);
        continue;
      }
      const audit: ReviewRecheckAutoApply = {
        policy: REVIEW_RECHECK_POLICY, program_id: program.id,
        fetched_url: review.source, final_url: page.url, page_hash: page.hash,
        matched_name: name, matched_intake: `${review.intake}: ${reading.phrase}`,
        previous_checked_on: review.checked_on, previous_review_after: review.review_after,
        checked_on: renewal.checked_on, review_after: renewal.review_after,
      };
      const proposal = await queue({
        type: 'profile_note', org: program.org, program: program.name,
        title: `${program.name}: review renewal from its official page`,
        summary: `Review due ${review.review_after}. ${evidence} The page names ${program.name} and says "${reading.phrase}", which supports the recorded ${review.intake} intake. Renews checked_on to ${renewal.checked_on} and review_after to ${renewal.review_after}; nothing else changes.`,
        evidence_url: review.source, proposed_change: change, signal_id: signal('renewal'), wire: program.wires?.[0] ?? null,
      });
      if (!proposal) {
        skip('already_recorded');
        continue;
      }
      await pause();
      const result = await decide({
        id: proposal.id,
        decision: 'approved',
        by: 'machine',
        note: `auto: review renewed from ${page.url} ("${name}", ${audit.matched_intake}, ${REVIEW_RECHECK_POLICY})`,
        review_recheck_auto_apply: audit,
        // The payload checked above; a changed one is refused.
        expect_change_hash: proposalChangeHash(change),
      });
      if (result.status === 200) {
        summary.renewed.push({ program_id: program.id, proposal_id: proposal.id, review_after: renewal.review_after, final_url: page.url });
        continue;
      }
      const why = message(result.body.error || `status_${result.status}`);
      summary.queued.push({ program_id: program.id, proposal_id: proposal.id, kind: 'apply_failed', reason: why });
      if (result.body.reconciliation_hold) summary.halted = 'halted_after_reconciliation_hold';
    } catch (error) {
      summary.errors.push(`${listed.id}: ${message(error)}`);
    }
  }
  return summary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function countBy(rows: unknown, key: string): string {
  const counts = new Map<string, number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = isRecord(row) ? String(row[key] ?? 'unknown') : 'unknown';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].map(([value, n]) => `${value} ${n}`).join(', ');
}

/** One /admin/health line for the last run's recheck, or null when it did not run. */
export function reviewRecheckLine(value: unknown): { text: string; failed: boolean } | null {
  if (!isRecord(value)) return null;
  if (typeof value.error === 'string') return { text: `Review recheck: failed (${value.error})`, failed: true };
  const list = (key: string) => (Array.isArray(value[key]) ? (value[key] as unknown[]) : []);
  const queued = list('queued'), failed = list('failed'), skipped = list('skipped'), errors = list('errors');
  const part = (n: number, label: string, detail: string) => `${n} ${label}${n && detail ? ` (${detail})` : ''}`;
  return {
    text:
      `Review recheck: ${list('renewed').length} renewed, ` +
      `${part(queued.length, 'queued for owner', countBy(queued, 'kind'))}, ` +
      `${part(failed.length, 'fetch failed', failed.map((row) => (isRecord(row) ? String(row.program_id) : '')).filter(Boolean).slice(0, 5).join(', '))}, ` +
      `${part(skipped.length, 'skipped', countBy(skipped, 'reason'))}` +
      ` (${Number(value.due) || 0} due, ${Number(value.fetched) || 0} pages fetched)` +
      (typeof value.halted === 'string' ? `. Halted: ${value.halted}` : '') +
      (errors.length ? `. Errors: ${errors.slice(0, 3).map(String).join('; ')}` : ''),
    failed: errors.length > 0 || typeof value.halted === 'string',
  };
}
