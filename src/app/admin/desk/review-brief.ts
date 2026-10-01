// Turns a queue proposal into the few lines an owner can act on: a
// recommendation, the official source, and plain facts. Reads fields the
// proposal already carries (curator reason/quotes, evidence URL, proposed
// record). Does not decide anything and does not change Approve.
import { dateShort, WIRE_LABEL } from '../../../lib/format';
import type { CuratorReview, Proposal, ProposalType, Wire } from '../../../lib/types';
import { TYPE_SLUG_LABEL } from './desk-voice';

export type ReviewCall = 'approve' | 'reject' | 'check';

export interface ReviewSource {
  url: string;
  domain: string;
  quotes: string[];
}

export interface ReviewFact {
  label: string;
  value: string;
  href?: string;
  /** Set when a curator review replaces the proposal's value. */
  corrected?: boolean;
}

/** Enough of a proposal to brief it. Signal evidence is optional. */
export interface ReviewInput {
  type: ProposalType;
  org: string | null;
  org_name?: string | null;
  program?: string | null;
  title: string;
  evidence_url?: string | null;
  proposed_change?: Record<string, unknown>;
  wire?: Wire | null;
  submitted_by?: Proposal['submitted_by'];
  curator_review?: Proposal['curator_review'];
  validation?: Proposal['validation'];
  evidence?: { source_url?: string | null } | null;
}

export interface ReviewBrief {
  call: ReviewCall;
  /** Pill text. A curator review replaces the generated call. */
  pill: string;
  /** True when the pill and reason come from a stored curator review. */
  curator: boolean;
  /** One sentence. The curator's reason when the proposal carries one. */
  reason: string;
  /** True when `reason` is the curator's own sentence, not a line we derived. */
  reasonFromProposal: boolean;
  title: string;
  facts: ReviewFact[];
  sources: ReviewSource[];
  unsourced: boolean;
  proposer: string;
}

const BLOCKED_KEYS = new Set(['remove', 'delete', 'action', 'merge', 'drop']);

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  concluded: 'Concluded',
  announced: 'Announced',
  unknown: 'Unknown',
  'winding-down': 'Winding down',
  dormant: 'Dormant',
  dead: 'Dead',
  open: 'Open',
  reviewing: 'In review',
  closed: 'Closed',
  deployed: 'Deployed',
};

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function sourceDomain(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function curatorPill(verdict: CuratorReview['verdict']): string {
  if (verdict === 'approve') return 'Curator: Approve';
  if (verdict === 'reject') return 'Curator: Reject';
  return 'Curator: Needs owner';
}

function oneSentence(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  const sentence = flat.match(/^.{8,240}?[.!?](?:\s|$)/);
  if (sentence) return sentence[0].trim();
  if (flat.length <= 240) return flat;
  return `${flat.slice(0, 237)}...`;
}

/** Same destructive keys the curator API refuses. A recommendation only. */
function containsBlockedKey(value: unknown, depth = 0): boolean {
  if (depth > 6 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsBlockedKey(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => BLOCKED_KEYS.has(key) || containsBlockedKey(child, depth + 1)
  );
}

function fileRecords(change: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!change) return [];
  const records: Record<string, unknown>[] = [];
  for (const [key, value] of Object.entries(change)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (key.includes('/') || /\.(ya?ml|jsonl)$/i.test(key)) records.push(value as Record<string, unknown>);
  }
  return records;
}

function roundsOf(records: Record<string, unknown>[]): Record<string, unknown>[] {
  const rounds: Record<string, unknown>[] = [];
  for (const record of records) {
    if (!Array.isArray(record.rounds)) continue;
    for (const round of record.rounds) {
      if (round && typeof round === 'object' && !Array.isArray(round)) rounds.push(round as Record<string, unknown>);
    }
  }
  return rounds;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function stripSweep(title: string): string {
  const stripped = title
    .replace(/^Sweep:\s*/i, '')
    .replace(/\s+[—–-]\s+.*$/, '')
    .replace(/\s+\([^)]*\)\s*$/, '')
    .trim();
  return stripped || title;
}

function statusLabel(value: string): string {
  return STATUS_LABEL[value] || value.charAt(0).toUpperCase() + value.slice(1);
}

function collectSources(proposal: ReviewInput): ReviewSource[] {
  const quotes = new Map<string, string[]>();
  const order: string[] = [];

  function add(url: unknown) {
    const href = httpsUrl(url);
    if (!href || quotes.has(href)) return;
    quotes.set(href, []);
    order.push(href);
  }

  function addQuote(url: unknown, quote: unknown) {
    const href = httpsUrl(url);
    const line = text(quote)?.replace(/\s+/g, ' ');
    if (!href || !line || line.length < 12) return;
    if (!quotes.has(href)) {
      quotes.set(href, []);
      order.push(href);
    }
    const list = quotes.get(href)!;
    if (!list.includes(line)) list.push(line);
  }

  for (const quote of proposal.submitted_by?.quotes || []) addQuote(quote.url, quote.quote);
  for (const url of proposal.submitted_by?.sources || []) add(url);
  add(proposal.evidence_url);
  add(proposal.evidence?.source_url);
  walkSources(proposal.proposed_change, add, 0);

  return order.map((url) => ({ url, domain: sourceDomain(url), quotes: quotes.get(url) || [] }));
}

function walkSources(value: unknown, add: (url: unknown) => void, depth: number) {
  if (depth > 6 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walkSources(item, add, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'source' || key === 'evidence_url') add(child);
    else if (key === 'sources' && Array.isArray(child)) {
      for (const item of child) add(item);
    } else if (child && typeof child === 'object') walkSources(child, add, depth + 1);
  }
}

export function proposerLabel(proposal: { submitted_by?: { key_name?: string }; title?: string }): string {
  const name = proposal.submitted_by?.key_name?.trim();
  if (name) return name;
  if ((proposal.title || '').startsWith('Sweep:')) return 'Sweep';
  return 'Wire';
}

function shortTitle(proposal: ReviewInput, records: Record<string, unknown>[]): string {
  const named = unique(records.map((record) => text(record.name)));
  if (proposal.type === 'merge_orgs') {
    const change = proposal.proposed_change || {};
    const a = text(change.a) || proposal.org;
    const b = text(change.b);
    if (a && b) return `Merge ${a} and ${b}`;
  }
  if (proposal.type === 'new_org') return text(proposal.org_name) || named[0] || stripSweep(proposal.title);
  if (proposal.type === 'new_program') return text(proposal.program) || named[0] || stripSweep(proposal.title);
  if (proposal.type === 'new_award') {
    const grantee = records.map((record) => text(record.grantee_name)).find(Boolean);
    if (grantee) return `Award to ${grantee}`;
  }
  return text(proposal.program) || text(proposal.org_name) || named[0] || stripSweep(proposal.title);
}

function factsFor(proposal: ReviewInput, records: Record<string, unknown>[], title: string): ReviewFact[] {
  const facts: ReviewFact[] = [];
  const push = (label: string, value: string | null | undefined, href?: string) => {
    if (!value) return;
    facts.push({ label, value, ...(href ? { href } : {}) });
  };

  push('Name', title);
  if (proposal.org) push('Org', text(proposal.org_name) || proposal.org, `/orgs/${proposal.org}`);
  else if (proposal.type === 'new_org') push('Org', 'Not on file');
  else if (text(proposal.org_name)) push('Org', text(proposal.org_name));

  push('Kind', TYPE_SLUG_LABEL[proposal.type]);
  if (proposal.wire && WIRE_LABEL[proposal.wire]) push('Wire', WIRE_LABEL[proposal.wire]);

  const rounds = roundsOf(records);
  const roundStatus = unique(rounds.map((round) => text(round.status)));
  const recordStatus = unique(records.map((record) => text(record.status)));
  const status = (roundStatus.length ? roundStatus : recordStatus).map(statusLabel).join(' · ');
  push('Status', status || null);

  const deadlines = unique(rounds.map((round) => text(round.closes))).map((day) => dateShort(day));
  push('Deadline', deadlines.join(' · ') || null);

  const amounts = unique([
    ...rounds.map((round) => text(round.size) || text(round.amount)),
    ...records.map((record) => text(record.amount_text) || text(record.size) || text(record.amount)),
  ]);
  push('Amount', amounts.join(' · ') || null);

  const website = records.map((record) => httpsUrl(record.website)).find(Boolean)
    || records.map((record) => httpsUrl(record.apply_url)).find(Boolean);
  if (website) push('Website', sourceDomain(website), website);

  if (proposal.type === 'merge_orgs') {
    const domain = text(proposal.proposed_change?.domain);
    if (domain) push('Website', domain, domain.includes('://') ? domain : `https://${domain}`);
  }

  return facts;
}

function recommendation(proposal: ReviewInput, sources: ReviewSource[]): { call: ReviewCall; reason: string; reasonFromProposal: boolean } {
  const curatorReason = text(proposal.submitted_by?.reason);
  const carried = curatorReason ? oneSentence(curatorReason) : null;
  const quoted = sources.some((source) => source.quotes.length > 0);
  const machineFailed = Boolean(proposal.validation && !proposal.validation.never_auto);

  if (containsBlockedKey(proposal.proposed_change)) {
    return {
      call: 'reject',
      reason: 'This change asks to delete or remove a record.',
      reasonFromProposal: false,
    };
  }
  if (proposal.type === 'merge_orgs') {
    return {
      call: 'check',
      reason: carried || 'Confirm these are the same organization. Approving records the decision and does not change files.',
      reasonFromProposal: Boolean(carried),
    };
  }
  if (machineFailed) {
    const machine = text(proposal.validation?.reason);
    return {
      call: 'check',
      reason: machine ? oneSentence(machine) : 'The machine check failed.',
      reasonFromProposal: Boolean(machine),
    };
  }
  if (sources.length === 0) {
    return {
      call: 'check',
      reason: carried || 'No official source is on file.',
      reasonFromProposal: Boolean(carried),
    };
  }
  if (!quoted) {
    return {
      call: 'check',
      reason: carried || 'Official page is on file, but there is no verbatim quote.',
      reasonFromProposal: Boolean(carried),
    };
  }
  if (carried) return { call: 'approve', reason: carried, reasonFromProposal: true };
  return {
    call: 'check',
    reason: 'A verbatim quote is on file. Read it before approving.',
    reasonFromProposal: false,
  };
}

function sourcesFromReview(review: CuratorReview): ReviewSource[] {
  const quotes = new Map<string, string[]>();
  const order: string[] = [];
  for (const source of review.sources) {
    const href = httpsUrl(source.url);
    const line = text(source.quote)?.replace(/\s+/g, ' ');
    if (!href) continue;
    if (!quotes.has(href)) {
      quotes.set(href, []);
      order.push(href);
    }
    if (line && !quotes.get(href)!.includes(line)) quotes.get(href)!.push(line);
  }
  return order.map((url) => ({ url, domain: sourceDomain(url), quotes: quotes.get(url) || [] }));
}

function applyCorrections(facts: ReviewFact[], proposal: ReviewInput, title: string): ReviewFact[] {
  const review = proposal.curator_review?.facts;
  if (!review) return facts;
  const next = facts.map((fact) => ({ ...fact }));

  function setFact(label: string, value: string | null | undefined, href?: string) {
    if (!value) return;
    const index = next.findIndex((fact) => fact.label === label);
    if (index === -1) {
      next.push({ label, value, corrected: true, ...(href ? { href } : {}) });
      return;
    }
    if (sameText(next[index].value, value)) return;
    next[index] = { ...next[index], value, corrected: true, ...(href ? { href } : {}) };
  }

  if (review.status) setFact('Status', statusLabel(review.status));
  if (review.deadline) setFact('Deadline', dateShort(review.deadline));
  if (review.amount) setFact('Amount', review.amount);
  if (review.org_name) setFact('Org', review.org_name, proposal.org ? `/orgs/${proposal.org}` : undefined);
  if (review.program_name && !sameText(review.program_name, title) && !sameText(review.program_name, text(proposal.program) || '')) {
    setFact('Program', review.program_name);
  }
  return next;
}

export function reviewBrief(proposal: ReviewInput): ReviewBrief {
  const records = fileRecords(proposal.proposed_change);
  const generated = collectSources(proposal);
  const title = shortTitle(proposal, records);
  const call = recommendation(proposal, generated);
  const review = proposal.curator_review;
  const sources = review ? sourcesFromReview(review) : generated;
  const pill = review ? curatorPill(review.verdict) : call.call === 'approve' ? 'Approve' : call.call === 'reject' ? 'Reject' : 'Check';
  return {
    call: call.call,
    pill,
    curator: Boolean(review),
    reason: review ? oneSentence(review.reason) : call.reason,
    reasonFromProposal: review ? true : call.reasonFromProposal,
    title,
    facts: applyCorrections(factsFor(proposal, records, title), proposal, title),
    sources,
    unsourced: sources.length === 0,
    proposer: proposerLabel(proposal),
  };
}
