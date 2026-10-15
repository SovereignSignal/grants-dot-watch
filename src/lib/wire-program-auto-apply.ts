// Wire program auto-apply (WIRE_PROGRAM_AUTO_APPLY=1). The daily ingest calls
// runWireProgramAutoApply inside its lock and once-per-day claim, after the
// Wire ingest has queued today's proposals. It looks at every pending Wire
// `new_program` (today's and the backlog), and approves one through
// decideProposal, the owner Desk path, as a machine decision only when the
// rule in machine-approval-policy.ts holds. Anything else stays pending,
// exactly as before, and its reasons go on the run summary.
//
// Only pending proposals are read. Nothing here builds registry or funding
// changes for decided proposals; decideProposal builds the one it approves.
import { fetchEvidencePage, hostMatchesRegisteredDomain, registeredDomain, type PageFetch } from './curator-auto-apply';
import { decideProposal, proposalChangeHash } from './desk-decide';
import { getIngestState, listProposals, setIngestState } from './desk-store';
import { WIRE_PROGRAM_AUTO_APPLY_POLICY, WIRE_PROGRAM_MIN_SCORE, wireProgramAutoApplyEnabled } from './machine-approval-policy';
import { matchAmountOnPage, parseAmount, visibleMoneyText, type ParsedAmount } from './money-match';
import { isValidIsoDate, norm, normalizeForMatch, pageContainsDate } from './proposal-validator';
import { loadRegistry } from './registry';
import { productDateISO } from './round-state';
import type { Org, Program, Proposal, WireProgramAutoApply } from './types';

/** Page fetches (and so approvals) per daily run. */
export const MAX_WIRE_PROGRAM_CHECKS = 15;
/** ingest_state key: proposal id -> when this pass last fetched its page. */
export const WIRE_PROGRAM_CHECKED_KEY = 'wire_program_auto_apply_checked';
const LEFT_LIMIT = 50;

const PROGRAM_KEY = /^programs\/([a-z0-9][a-z0-9-]*)\.yaml$/;
/**
 * What an auto-approved program may carry: the record the page can vouch for.
 * Each published value is either checked here or on the page:
 * - id, name: the slug and a name phrase found on the org's page;
 * - org: must equal the proposal's resolved org, which must be in the registry;
 * - apply_url, round source, evidence_url: on the org's registered domain;
 * - rounds: the ingest's one "Current call" round, open, whose closes date
 *   must appear on the page. A Wire amount (`size`) publishes only when
 *   `parseAmount` reads it (money, then at most a short plain-word
 *   qualifier) and the same page states the same value in the same currency,
 *   followed by the same qualifier (money-match.ts); it is published as
 *   queued, never rewritten. `opens` is never auto-published;
 * - wires: the committer takes the proposal's wire, which must be one of the
 *   org's own wires; systems cannot be set (the committer leaves them empty);
 * - summary: the one Wire free-text field the registry requires (40+ chars).
 *   It is published as filed, so it must be plain text: at most
 *   SUMMARY_MAX characters, no markup and no links. Anything else goes to the
 *   owner rather than being rewritten, so what is approved is what was queued.
 */
const PROGRAM_FIELDS = new Set(['id', 'name', 'org', 'apply_url', 'rounds']);
const ROUND_FIELDS = new Set(['name', 'status', 'closes', 'source']);
const ROUND_NAME = 'Current call';
const NAME_MAX = 120;
const SUMMARY_MIN = 40;
export const SUMMARY_MAX = 400;
/** Markup, links, bare domains with a path, and control characters. */
const UNSAFE_TEXT = /[<>]|https?:\/\/|www\.|\]\(|\b[a-z0-9-]+\.[a-z]{2,}\/|[\u0000-\u0008\u000b-\u001f\u007f]/i;

/** Words that never identify a program on their own. */
const GENERIC_TOKENS = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'by', 'with', 'at',
  'grant', 'grants', 'program', 'programs', 'programme', 'programmes', 'fund', 'funds', 'funding',
  'call', 'calls', 'round', 'rounds', 'open', 'new', 'initiative', 'initiatives', 'support',
  'application', 'applications', 'proposal', 'proposals', 'rfp', 'rfps', 'season', 'cohort',
  'phase', 'award', 'awards', 'prize', 'prizes',
]);

/** Visible-text phrases that say applications are being taken. */
export const OPEN_PHRASES = [
  'applications open', 'applications are open', 'applications now open', 'applications are now open',
  'submissions open', 'submissions are open', 'now accepting', 'accepting applications',
  'accepting proposals', 'accepting submissions', 'apply now', 'apply here', 'apply today',
  'how to apply', 'submit an application', 'submit your application', 'submit a proposal',
  'submit your proposal', 'application form', 'start your application', 'open call',
  'rolling basis', 'rolling applications',
];
/** Any of these leaves the item for the owner, even beside an open phrase. */
export const CLOSED_PHRASES = [
  'applications closed', 'applications are closed', 'applications are now closed', 'submissions closed',
  'submissions are closed', 'now closed', 'call closed', 'call is closed', 'deadline has passed',
  'no longer accepting', 'not accepting applications', 'not currently accepting', 'applications paused',
  'temporarily paused', 'program has ended', 'program has concluded',
];

export interface WireProgramPlan {
  proposal: Proposal;
  slug: string;
  name: string;
  orgId: string;
  domain: string;
  /** apply_url when the record carries one, else evidence_url. */
  url: string;
  deadlines: string[];
  /** The round's Wire amount as queued, and how it parsed. */
  amount: { raw: string; parsed: ParsedAmount } | null;
  score: number;
  nameCandidates: string[];
}

export type Assessment = { ok: true; plan: WireProgramPlan } | { ok: false; reasons: string[] };

/** Program ids, `<org>:<normalized name>` keys and apply-URL keys. The same
 *  shape holds what the registry has and what this run already approved. */
export interface RunClaims {
  ids: Set<string>;
  names: Set<string>;
  urls: Set<string>;
}

export function programIndex(programs: Program[]): RunClaims {
  const index: RunClaims = { ids: new Set(), names: new Set(), urls: new Set() };
  for (const program of programs) {
    index.ids.add(program.id);
    index.names.add(`${program.org}:${norm(program.name)}`);
    const key = urlKey(program.apply_url);
    if (key) index.urls.add(key);
  }
  return index;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Host without www, path without a trailing slash, query kept, fragment and scheme dropped. */
export function urlKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    return `${host}${path}${url.search}`;
  } catch {
    return null;
  }
}

function specificPhrase(phrase: string): boolean {
  const tokens = phrase.split(' ').filter(Boolean);
  return tokens.length >= 2 && phrase.length >= 8 && tokens.some((t) => t.length >= 3 && !GENERIC_TOKENS.has(t) && !/^\d+$/.test(t));
}

/**
 * The name phrases this pass accepts, in the order it tries them. Each is
 * normalized with `normalizeForMatch` (lowercase, diacritics and markup
 * removed, every run of punctuation or whitespace collapsed to one space):
 * 1. the proposed program name;
 * 2. the proposal title's core name: the part after `<org name> · ` when the
 *    title has exactly that shape (the Wire ingest's title);
 * 3. either of those with a leading org name or alias removed.
 * A phrase counts only if it has at least two words, at least eight
 * characters, and one word of three or more letters that is not generic
 * (grants, program, fund, round, ...) and not a bare number. The page must
 * contain the whole phrase between word boundaries; a scattering of its words
 * does not count.
 */
export function programNameCandidates(input: { name: string; title?: string | null; orgNames: Array<string | null | undefined> }): string[] {
  const orgKeys = [...new Set(input.orgNames.map((n) => normalizeForMatch(n || '')).filter(Boolean))].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    const phrase = normalizeForMatch(raw || '');
    if (phrase && specificPhrase(phrase) && !out.includes(phrase)) out.push(phrase);
  };
  add(input.name);
  const parts = (input.title || '').split(' · ');
  if (parts.length === 2 && orgKeys.includes(normalizeForMatch(parts[0]))) add(parts[1]);
  const bases = [normalizeForMatch(input.name), parts.length === 2 ? normalizeForMatch(parts[1]) : ''];
  for (const base of bases) {
    const org = orgKeys.find((key) => base.startsWith(`${key} `));
    if (org) add(base.slice(org.length + 1));
  }
  return out;
}

/**
 * Every check that needs no network: provenance, shape, known org, domain,
 * score, deadline and dedupe. `claims` carries what this run already approved.
 */
export function assessWireProgram(
  p: Proposal,
  ctx: { orgs: Org[]; programs: Program[]; today: string; claims?: RunClaims; index?: RunClaims }
): Assessment {
  const reasons: string[] = [];
  if (p.type !== 'new_program') return { ok: false, reasons: ['not_new_program'] };
  if (p.state !== 'pending') return { ok: false, reasons: ['not_pending'] };
  if (typeof p.signal_id !== 'string' || !p.signal_id.startsWith('wire:')) return { ok: false, reasons: ['not_wire'] };
  if (p.submitted_by) reasons.push('curator_queued');
  if (p.curator_review && p.curator_review.verdict !== 'approve') reasons.push('curator_flagged');

  const entries = Object.entries(p.proposed_change || {});
  const match = entries.length === 1 ? PROGRAM_KEY.exec(entries[0][0]) : null;
  const payload = match ? entries[0][1] : null;
  if (!match || !isRecord(payload)) return { ok: false, reasons: [...reasons, 'unexpected_shape'] };
  const slug = match[1];
  if (Object.keys(payload).some((key) => !PROGRAM_FIELDS.has(key))) reasons.push('unexpected_fields');
  if (payload.id !== undefined && payload.id !== slug) reasons.push('id_mismatch');
  const name = (typeof payload.name === 'string' ? payload.name : p.program || '').trim();
  if (!name) return { ok: false, reasons: [...reasons, 'no_name'] };
  if (name.length > NAME_MAX || UNSAFE_TEXT.test(name)) reasons.push('name_unsafe');
  const summary = (p.summary || '').trim();
  if (summary.length < SUMMARY_MIN) reasons.push('summary_too_thin');
  else if (summary.length > SUMMARY_MAX) reasons.push('summary_too_long');
  if (UNSAFE_TEXT.test(summary)) reasons.push('summary_has_markup_or_links');

  const deadlines: string[] = [];
  const roundSources: unknown[] = [];
  let amount: WireProgramPlan['amount'] = null;
  if (payload.rounds !== undefined) {
    const rounds = Array.isArray(payload.rounds) ? payload.rounds : null;
    const shapeOk = rounds !== null && rounds.length <= 1 && rounds.every((round) =>
      isRecord(round) &&
      Object.keys(round).every((key) => ROUND_FIELDS.has(key) || key === 'size') &&
      round.name === ROUND_NAME &&
      (round.status === undefined || round.status === 'open') &&
      (round.closes === undefined || (typeof round.closes === 'string' && isValidIsoDate(round.closes)))
    );
    if (!shapeOk) reasons.push('unexpected_rounds');
    else {
      for (const round of rounds as Record<string, unknown>[]) {
        if (typeof round.closes === 'string') deadlines.push(round.closes);
        if (round.source !== undefined) roundSources.push(round.source);
        if (round.size !== undefined) {
          const parsed = parseAmount(round.size);
          if (parsed) amount = { raw: round.size as string, parsed };
          else reasons.push('amount_unparsed');
        }
      }
    }
  }

  const orgId = p.org;
  if (!orgId) return { ok: false, reasons: [...reasons, 'unknown_org'] };
  if (payload.org !== undefined && payload.org !== orgId) return { ok: false, reasons: [...reasons, 'org_mismatch'] };
  const org = ctx.orgs.find((candidate) => candidate.id === orgId);
  if (!org) return { ok: false, reasons: [...reasons, 'unknown_org'] };
  // The committer publishes the proposal's wire on the program; it must be the org's.
  if (!p.wire || !(org.wires || []).includes(p.wire)) reasons.push('wire_not_org_wire');
  const domain = registeredDomain(org.website);
  if (!domain) return { ok: false, reasons: [...reasons, 'no_registered_website'] };

  const applyUrl = payload.apply_url;
  const url = typeof applyUrl === 'string' && applyUrl ? applyUrl : p.evidence_url || '';
  if (!url) return { ok: false, reasons: [...reasons, 'no_url'] };
  const recordUrls: unknown[] = [url, ...(p.evidence_url ? [p.evidence_url] : []), ...(applyUrl !== undefined ? [applyUrl] : []), ...roundSources];
  if (recordUrls.some((value) => typeof value !== 'string' || !hostMatchesRegisteredDomain(value, domain))) reasons.push('off_domain_url');
  else {
    const parsed = new URL(url);
    if (parsed.pathname.replace(/\/+$/, '') === '' && !parsed.search) reasons.push('homepage_url');
  }

  const score = typeof p.confidence === 'number' && Number.isFinite(p.confidence) ? p.confidence : null;
  if (score === null) reasons.push('no_score');
  else if (score < WIRE_PROGRAM_MIN_SCORE) reasons.push('low_score');

  if (deadlines.some((day) => day < ctx.today)) reasons.push('deadline_passed');

  const nameKey = `${orgId}:${norm(name)}`;
  const key = urlKey(url);
  const sets = [ctx.index ?? programIndex(ctx.programs), ...(ctx.claims ? [ctx.claims] : [])];
  if (sets.some((set) => set.ids.has(slug))) reasons.push('duplicate_id');
  if (sets.some((set) => set.names.has(nameKey))) reasons.push('duplicate_name');
  if (key && sets.some((set) => set.urls.has(key))) reasons.push('duplicate_url');

  const nameCandidates = programNameCandidates({ name, title: p.title, orgNames: [org.name, ...(org.aka || []), p.org_name] });
  if (!nameCandidates.length) reasons.push('name_not_specific');

  if (reasons.length) return { ok: false, reasons };
  return { ok: true, plan: { proposal: p, slug, name, orgId, domain, url, deadlines, amount, score: score as number, nameCandidates } };
}

/** The page half of the rule: name phrase, open signal or deadline, no closed
 *  phrase, and the Wire amount (when there is one) stated on the same page. */
export function confirmWireProgramPage(
  plan: WireProgramPlan,
  page: PageFetch
): { ok: true; matched_name: string; matched_signal: string; matched_amount: string | null } | { ok: false; reasons: string[] } {
  if (!page.ok) return { ok: false, reasons: ['fetch_failed'] };
  if (!hostMatchesRegisteredDomain(page.url, plan.domain)) return { ok: false, reasons: ['off_domain_redirect'] };
  const text = ` ${normalizeForMatch(page.body)} `;
  const has = (phrase: string) => text.includes(` ${phrase} `);
  const reasons: string[] = [];
  const matchedName = plan.nameCandidates.find(has) ?? null;
  if (!matchedName) reasons.push('name_not_on_page');
  if (CLOSED_PHRASES.some(has)) reasons.push('page_says_closed');
  const phrase = OPEN_PHRASES.find(has);
  // Every deadline the record would publish must be on the page.
  if (plan.deadlines.some((day) => !pageContainsDate(page.body, day))) reasons.push('deadline_not_on_page');
  const deadline = phrase ? null : plan.deadlines.find((day) => pageContainsDate(page.body, day)) ?? null;
  if (!phrase && !deadline) reasons.push('no_open_signal');
  const amountMatch = plan.amount ? matchAmountOnPage(plan.amount.parsed, visibleMoneyText(page.body)) : null;
  if (amountMatch && !amountMatch.ok) reasons.push(amountMatch.reason);
  const matchedAmount = amountMatch?.ok ? amountMatch.text : null;
  if (reasons.length || !matchedName) return { ok: false, reasons };
  return {
    ok: true,
    matched_name: matchedName,
    matched_signal: phrase ? `phrase: ${phrase}` : `deadline: ${deadline}`,
    matched_amount: matchedAmount,
  };
}

export interface WireProgramAutoApplySummary {
  at: string;
  policy: string;
  /** Pending Wire new_program items seen this run. */
  candidates: number;
  /** Pages fetched this run. */
  checked: number;
  approved: { proposal_id: string; program: string; url: string }[];
  left_count: number;
  /** The first LEFT_LIMIT items left pending, with every reason recorded. */
  left: { proposal_id: string; program: string; reasons: string[] }[];
  halted?: string;
}

export interface WireProgramAutoApplyDeps {
  env?: NodeJS.ProcessEnv;
  listPending?: () => Promise<Proposal[]>;
  registry?: () => { orgs: Org[]; programs: Program[] };
  fetchPage?: (url: string, allowedDomain: string) => Promise<PageFetch>;
  decide?: typeof decideProposal;
  getState?: (key: string) => Promise<unknown>;
  setState?: (key: string, value: unknown) => Promise<void>;
  now?: () => Date;
  yieldTurn?: () => Promise<void>;
  maxChecks?: number;
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 200);

/** One pass. Returns null and touches nothing while the flag is off. Never
 *  throws for one item; the caller still wraps it so the Wire run is safe. */
export async function runWireProgramAutoApply(deps: WireProgramAutoApplyDeps = {}): Promise<WireProgramAutoApplySummary | null> {
  if (!wireProgramAutoApplyEnabled(deps.env ?? process.env)) return null;
  const listPending = deps.listPending ?? (() => listProposals({ state: 'pending' }));
  const registry = deps.registry ?? (() => loadRegistry());
  const fetchPage = deps.fetchPage ?? ((url: string, domain: string) => fetchEvidencePage(url, domain));
  const decide = deps.decide ?? decideProposal;
  const getState = deps.getState ?? getIngestState;
  const setState = deps.setState ?? setIngestState;
  const now = deps.now ?? (() => new Date());
  const pause = deps.yieldTurn ?? turn;
  const cap = deps.maxChecks ?? MAX_WIRE_PROGRAM_CHECKS;

  const today = productDateISO(now());
  const pending = (await listPending()).filter(
    (p) => p.type === 'new_program' && p.state === 'pending' && typeof p.signal_id === 'string' && p.signal_id.startsWith('wire:')
  );
  const left: WireProgramAutoApplySummary['left'] = [];
  const leave = (p: Proposal, reasons: string[]) => left.push({ proposal_id: p.id, program: p.program || p.title, reasons });
  const approved: WireProgramAutoApplySummary['approved'] = [];

  // Network-free checks over everything pending.
  const first = registry();
  const firstIndex = programIndex(first.programs);
  const ready: WireProgramPlan[] = [];
  for (const p of pending) {
    const result = assessWireProgram(p, { ...first, today, index: firstIndex });
    if (result.ok) ready.push(result.plan);
    else leave(p, result.reasons);
  }

  // Least recently fetched first, so a standing backlog cannot starve new items.
  let checkedAt: Record<string, string> = {};
  try {
    const stored = await getState(WIRE_PROGRAM_CHECKED_KEY);
    if (isRecord(stored)) checkedAt = Object.fromEntries(Object.entries(stored).filter(([, at]) => typeof at === 'string')) as Record<string, string>;
  } catch {
    checkedAt = {};
  }
  ready.sort((a, b) => {
    const at = checkedAt[a.proposal.id] ?? '', bt = checkedAt[b.proposal.id] ?? '';
    if (at !== bt) return at.localeCompare(bt);
    return b.proposal.created_at.localeCompare(a.proposal.created_at);
  });
  const selected = ready.slice(0, Math.max(0, cap));
  for (const plan of ready.slice(selected.length)) leave(plan.proposal, ['check_cap']);

  const claims: RunClaims = { ids: new Set(), names: new Set(), urls: new Set() };
  let checked = 0;
  let halted: string | undefined;
  for (const initial of selected) {
    const p = initial.proposal;
    if (halted) {
      leave(p, [halted]);
      continue;
    }
    await pause();
    try {
      // Re-check against the registry as it is now; an earlier approval may have changed it.
      const fresh = assessWireProgram(p, { ...registry(), today, claims });
      if (!fresh.ok) {
        leave(p, fresh.reasons);
        continue;
      }
      const plan = fresh.plan;
      let page: PageFetch;
      try {
        page = await fetchPage(plan.url, plan.domain);
      } catch {
        page = { ok: false, reason: 'fetch_failed' };
      }
      checked++;
      checkedAt[p.id] = now().toISOString();
      const confirmed = confirmWireProgramPage(plan, page);
      if (!confirmed.ok) {
        leave(p, confirmed.reasons);
        continue;
      }
      if (!page.ok) continue; // narrowed by confirmWireProgramPage
      const audit: WireProgramAutoApply = {
        policy: WIRE_PROGRAM_AUTO_APPLY_POLICY,
        fetched_url: plan.url,
        final_url: page.url,
        page_hash: page.hash,
        matched_name: confirmed.matched_name,
        matched_signal: confirmed.matched_signal,
        ...(plan.amount && confirmed.matched_amount ? { amount: plan.amount.raw, matched_amount: confirmed.matched_amount } : {}),
        score: plan.score,
      };
      await pause();
      const result = await decide({
        id: p.id,
        decision: 'approved',
        by: 'machine',
        note: `auto: Wire program confirmed on ${plan.domain} ("${confirmed.matched_name}", ${confirmed.matched_signal}${confirmed.matched_amount ? `, amount "${confirmed.matched_amount}"` : ''}, score ${plan.score}, ${WIRE_PROGRAM_AUTO_APPLY_POLICY})`,
        wire_program_auto_apply: audit,
        // The payload assessed and confirmed above; a changed one is refused.
        expect_change_hash: proposalChangeHash(p.proposed_change),
      });
      if (result.status === 200) {
        approved.push({ proposal_id: p.id, program: plan.name, url: page.url });
        claims.ids.add(plan.slug);
        claims.names.add(`${plan.orgId}:${norm(plan.name)}`);
        const key = urlKey(plan.url);
        if (key) claims.urls.add(key);
        delete checkedAt[p.id];
        continue;
      }
      if (result.body.reconciliation_hold) {
        // The registry may have changed under this proposal: stop for the run.
        halted = 'halted_after_reconciliation_hold';
        leave(p, ['reconciliation_hold']);
        continue;
      }
      leave(p, [`apply_failed: ${message(result.body.error || `status_${result.status}`)}`]);
    } catch (error) {
      leave(p, [`error: ${message(error)}`]);
    }
  }

  // Keep timestamps only for items still waiting on a page check.
  const waiting = new Set(ready.map((plan) => plan.proposal.id));
  try {
    await setState(WIRE_PROGRAM_CHECKED_KEY, Object.fromEntries(Object.entries(checkedAt).filter(([id]) => waiting.has(id))));
  } catch {
    // Ordering only. A failed write must not fail the run.
  }

  return {
    at: now().toISOString(),
    policy: WIRE_PROGRAM_AUTO_APPLY_POLICY,
    candidates: pending.length,
    checked,
    approved,
    left_count: left.length,
    left: left.slice(0, LEFT_LIMIT),
    ...(halted ? { halted } : {}),
  };
}

/** One /admin/health line for the last run's summary, or null when the pass did not run. */
export function wireProgramAutoApplyLine(value: unknown): { text: string; failed: boolean } | null {
  if (!isRecord(value)) return null;
  if (typeof value.error === 'string') return { text: `Wire programs: auto-apply failed (${value.error})`, failed: true };
  const approved = Array.isArray(value.approved) ? value.approved : [];
  const left = Array.isArray(value.left) ? value.left : [];
  const leftCount = typeof value.left_count === 'number' ? value.left_count : left.length;
  const detail = left.slice(0, 8).map((item) => {
    const row = isRecord(item) ? item : {};
    const reasons = Array.isArray(row.reasons) ? row.reasons.slice(0, 3).join(', ') : '';
    return `${String(row.proposal_id ?? 'item')}: ${reasons || 'not verified'}`;
  });
  return {
    text:
      `Wire programs: auto-apply on, ${approved.length} approved, ${leftCount} left for owner ` +
      `(${Number(value.candidates) || 0} pending, ${Number(value.checked) || 0} pages checked)` +
      (detail.length ? `: ${detail.join('; ')}${leftCount > detail.length ? '; …' : ''}` : '') +
      (typeof value.halted === 'string' ? `. Halted: ${value.halted}` : ''),
    failed: typeof value.halted === 'string',
  };
}
