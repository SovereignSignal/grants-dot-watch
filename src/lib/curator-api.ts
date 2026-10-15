// Authenticated curator surface. Decisions call decideProposal, the same
// function as the Desk buttons. Proposals call insertIngestProposals, the
// same insert door as wire ingest. Nothing here writes the registry itself.
import { createHash } from 'node:crypto';
import {
  assessXHandleApply,
  autoApplyNote,
  curatorAutoApplyEnabled,
  curatorAutoApplyTypes,
  fetchEvidencePage,
  readXHandleEdit,
  type PageFetch,
} from './curator-auto-apply';
import { buildProposalChanges, type ApplyResult } from './committer';
import { curatorJson, type CuratorGate, type CuratorIdentity, type CuratorScope, curatorGate } from './curator-auth';
import { defaultIdempotencyStore, type IdempotencyStore } from './curator-idempotency';
import { decideProposal, type DecideResult } from './desk-decide';
import { dateBounds } from './evidence-fields';
import { getProposal, insertIngestProposals, listProposals, saveCuratorReview, type CuratorReviewSave, type RawMinerProposal } from './desk-store';
import {
  buildCuratorProposal,
  directoryHits,
  officialHttpsUrl,
  proposalBlocked,
  type DirectoryHit,
} from './curator-proposals';
import { getSignalEvidence, type SignalEvidence } from './signal-lookup';
import { loadRegistry } from './registry';
import type { CuratorReview, CuratorReviewFacts, Proposal, ProposalType, Wire } from './types';

const TYPES = new Set<ProposalType>([
  'new_org',
  'new_program',
  'round_update',
  'deadline_change',
  'status_change',
  'new_award',
  'profile_note',
  'merge_orgs',
]);
const WIRES = new Set<Wire>(['crypto', 'ai', 'oss']);
const FORBIDDEN_FIELDS = new Set([
  'ids',
  'admin_token',
  'desk_owners',
  'reader_keys',
  'curator_keys',
  'grants_watch_reader_keys',
  'grants_watch_curator_keys',
  'database_url',
  'wire_database_url',
  'privy_app_secret',
]);
const DECIDE_FIELDS = new Set(['decision', 'reason', 'sources']);
const REVIEW_FIELDS = new Set(['verdict', 'reason', 'sources', 'facts']);
const REVIEW_FACT_FIELDS = new Set(['status', 'deadline', 'amount', 'org_name', 'program_name']);
const REVIEW_VERDICTS = new Set(['approve', 'reject', 'needs_owner']);
const PROPOSE_FIELDS = new Set([
  'kind',
  'fact',
  'reason',
  'summary',
  'title',
  'wire',
  'sources',
  'name',
  'website',
  'profile',
  'org_id',
  'program_id',
  'program_name',
  'apply_url',
  'status',
  'entity',
  'round',
  'opens',
  'closes',
  'x',
  'amount',
  'amount_target',
  'grantee',
  'date',
  'currency',
  'description',
  'into',
  'disposition',
]);
const LIST_PARAMS = ['lane', 'type', 'wire', 'score', 'min_score', 'q', 'page', 'limit'];
const SEARCH_PARAMS = ['q', 'kind', 'page', 'limit'];

export interface CuratorDeps {
  gate: CuratorGate;
  now: () => number;
  idempotency: IdempotencyStore;
  listProposals: typeof listProposals;
  getProposal: typeof getProposal;
  insertProposals: (candidates: RawMinerProposal[]) => Promise<{ inserted: Proposal[]; skipped: number }>;
  decide: (input: Parameters<typeof decideProposal>[0]) => Promise<DecideResult>;
  saveReview: (id: string, review: CuratorReview) => Promise<CuratorReviewSave>;
  loadRegistry: typeof loadRegistry;
  preview: (proposal: Proposal) => ApplyResult;
  evidence: (signalId: Proposal['signal_id']) => SignalEvidence | null;
  fetchPage?: (url: string, allowedDomain: string) => Promise<PageFetch>;
  autoApplyEnabled?: () => boolean;
  autoApplyTypes?: () => Set<string>;
}

let sharedIdempotency: IdempotencyStore | null = null;

function idempotencySingleton(): IdempotencyStore {
  if (!sharedIdempotency) sharedIdempotency = defaultIdempotencyStore();
  return sharedIdempotency;
}

export const defaultCuratorDeps: CuratorDeps = {
  gate: curatorGate,
  now: () => Date.now(),
  get idempotency() {
    return idempotencySingleton();
  },
  listProposals,
  getProposal,
  insertProposals: insertIngestProposals,
  decide: decideProposal,
  saveReview: saveCuratorReview,
  loadRegistry,
  preview: buildProposalChanges,
  evidence: getSignalEvidence,
};

function invalid(message: string, status = 400): Response {
  return curatorJson({ error: 'invalid_request', message }, status);
}

function singleParams(url: URL, allowed: string[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) return null;
    const values = url.searchParams.getAll(key);
    if (values.length !== 1) return null;
    out[key] = values[0];
  }
  return out;
}

function positiveInt(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) return null;
  return parsed;
}

function objectBody(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function readJson(request: Request): Promise<{ value: unknown } | { response: Response }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { response: invalid('Request body must be JSON.') };
  }
  if (!text.trim() || text.length > 100_000) return { response: invalid('Request body must be JSON.') };
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return { response: invalid('Request body must be JSON.') };
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function bodyHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function idempotencyHeader(request: Request): string | null {
  const value = request.headers.get('idempotency-key');
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) return null;
  return value;
}

function authorize(request: Request, scope: CuratorScope | readonly CuratorScope[], deps: CuratorDeps) {
  return deps.gate.authorize(request, scope);
}

const BULK_MAX = 50;
const BULK_FIELDS = new Set(['ids', 'decision', 'reason', 'sources']);
const BULK_FORBIDDEN = new Set([...FORBIDDEN_FIELDS].filter((field) => field !== 'ids'));

function autoApplyIsEnabled(deps: CuratorDeps): boolean {
  return (deps.autoApplyEnabled ?? (() => curatorAutoApplyEnabled()))();
}

function autoApplyAllowList(deps: CuratorDeps): Set<string> {
  return (deps.autoApplyTypes ?? (() => curatorAutoApplyTypes()))();
}

function orgSocial(deps: CuratorDeps, orgId: string): { website: string | null; oldValue: string | null } {
  const org = deps.loadRegistry().orgs.find((item) => item.id === orgId);
  return {
    website: org?.website ?? null,
    oldValue: typeof org?.socials?.x === 'string' ? org.socials.x : null,
  };
}

function clearHasEvidence(proposal: Proposal, reason: string): boolean {
  if (reason.trim().length < 8) return false;
  const sources = proposal.submitted_by?.sources || [];
  return sources.length > 0 || Boolean(proposal.evidence_url);
}

function matchesScore(score: string | undefined, minScore: number | undefined, confidence: number | undefined): boolean {
  if (score) {
    const value = confidence ?? -1;
    if (score === 'high' && value < 80) return false;
    if (score === 'mid' && (value < 60 || value >= 80)) return false;
    if (score === 'low' && (value < 0 || value >= 60)) return false;
  }
  if (minScore !== undefined && (confidence === undefined || confidence < minScore)) return false;
  return true;
}

function listItem(proposal: Proposal) {
  return {
    id: proposal.id,
    type: proposal.type,
    lane: proposal.lane,
    state: proposal.state,
    title: proposal.title,
    summary: proposal.summary,
    org: proposal.org,
    org_name: proposal.org_name ?? null,
    program: proposal.program ?? null,
    wire: proposal.wire ?? null,
    confidence: proposal.confidence ?? null,
    evidence_url: proposal.evidence_url ?? null,
    created_at: proposal.created_at,
    submitted_by: proposal.submitted_by
      ? { key_id: proposal.submitted_by.key_id, key_name: proposal.submitted_by.key_name, at: proposal.submitted_by.at }
      : null,
    curator_review: proposal.curator_review
      ? { verdict: proposal.curator_review.verdict, at: proposal.curator_review.at }
      : null,
  };
}

function detailItem(proposal: Proposal, deps: CuratorDeps) {
  let destination: string[] | null = null;
  let destinationError: string | null = null;
  let notes: string[] = [];
  try {
    const preview = deps.preview(proposal);
    destination = preview.changes.map((change) => change.path);
    notes = preview.notes;
  } catch (error) {
    destinationError = error instanceof Error ? error.message : 'destination could not be resolved';
  }
  const evidence = deps.evidence(proposal.signal_id);
  const sources = [...new Set([proposal.evidence_url, evidence?.source_url, ...(proposal.submitted_by?.sources || [])].filter(Boolean))];
  return {
    ...listItem(proposal),
    submitted_by: proposal.submitted_by ?? null,
    curator_review: proposal.curator_review ?? null,
    curator_review_history: proposal.curator_review_history ?? [],
    proposed_change: proposal.proposed_change ?? {},
    validation: proposal.validation ?? null,
    sources,
    quotes: proposal.submitted_by?.quotes ?? [],
    evidence,
    destination,
    destination_error: destinationError,
    preview_notes: notes,
  };
}

export async function listCuratorQueue(request: Request, deps: CuratorDeps = defaultCuratorDeps): Promise<Response> {
  const auth = authorize(request, 'read_queue', deps);
  if ('response' in auth) return auth.response;
  const params = singleParams(new URL(request.url), LIST_PARAMS);
  if (!params) return invalid('Unknown or repeated query parameter.');
  const page = positiveInt(params.page, 1, 10_000);
  const limit = positiveInt(params.limit, 50, 100);
  if (!page || !limit) return invalid('page and limit must be positive integers.');
  if (params.lane && params.lane !== 'judgment' && params.lane !== 'fact') return invalid('lane must be judgment or fact.');
  if (params.type && !TYPES.has(params.type as ProposalType)) return invalid('type is not a known proposal type.');
  if (params.wire && !WIRES.has(params.wire as Wire)) return invalid('wire must be crypto, ai, or oss.');
  if (params.score && !['high', 'mid', 'low'].includes(params.score)) return invalid('score must be high, mid, or low.');
  let minScore: number | undefined;
  if (params.min_score !== undefined) {
    if (!/^(0|[1-9]\d?|100)$/.test(params.min_score)) return invalid('min_score must be an integer from 0 to 100.');
    minScore = Number(params.min_score);
  }
  if (params.q && params.q.length > 200) return invalid('q is too long.');

  const proposals = await deps.listProposals({ state: 'pending' });
  const pending = proposals.filter((proposal) => proposal.state === 'pending');
  const needle = params.q?.trim().toLowerCase();
  const filtered = pending
    .filter((proposal) => !params.lane || proposal.lane === params.lane)
    .filter((proposal) => !params.type || proposal.type === params.type)
    .filter((proposal) => !params.wire || proposal.wire === params.wire)
    .filter((proposal) => matchesScore(params.score, minScore, proposal.confidence))
    .filter((proposal) => {
      if (!needle) return true;
      const hay = [proposal.title, proposal.summary, proposal.org, proposal.org_name, proposal.program, proposal.id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const offset = (page - 1) * limit;
  const data = offset >= filtered.length ? [] : filtered.slice(offset, offset + limit).map(listItem);
  return curatorJson({
    data,
    meta: {
      total: filtered.length,
      page,
      limit,
      next_page: offset + limit < filtered.length ? page + 1 : null,
      pending_judgment: pending.filter((proposal) => proposal.lane === 'judgment').length,
      pending_fact: pending.filter((proposal) => proposal.lane === 'fact').length,
    },
  });
}

export async function getCuratorItem(request: Request, id: string, deps: CuratorDeps = defaultCuratorDeps): Promise<Response> {
  const auth = authorize(request, 'read_queue', deps);
  if ('response' in auth) return auth.response;
  if (new URL(request.url).search) return invalid('Unknown or repeated query parameter.');
  if (!/^p\d+$/.test(id)) return curatorJson({ error: 'not_found' }, 404);
  const proposal = await deps.getProposal(id);
  if (!proposal) return curatorJson({ error: 'not_found' }, 404);
  return curatorJson({ data: detailItem(proposal, deps) });
}

function reasonText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 2000) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed)) return null;
  return trimmed;
}

function reviewReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 300) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed)) return null;
  return trimmed;
}

function reviewQuote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1 || trimmed.length > 2000) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed)) return null;
  return trimmed;
}

function reviewSources(value: unknown): { url: string; quote: string }[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const sources: { url: string; quote: string }[] = [];
  for (const item of value) {
    const source = objectBody(item);
    if (!source) return null;
    if (Object.keys(source).some((field) => field !== 'url' && field !== 'quote')) return null;
    const url = officialHttpsUrl(source.url);
    const quote = reviewQuote(source.quote);
    if (!url || !quote) return null;
    sources.push({ url, quote });
  }
  return sources;
}

function reviewFactText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1 || trimmed.length > max) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed)) return null;
  return trimmed;
}

function reviewFacts(value: unknown): CuratorReviewFacts | null | undefined {
  if (value === undefined) return undefined;
  const facts = objectBody(value);
  if (!facts) return null;
  if (Object.keys(facts).some((field) => !REVIEW_FACT_FIELDS.has(field))) return null;
  const out: CuratorReviewFacts = {};
  if ('status' in facts) {
    const status = reviewFactText(facts.status, 40);
    if (!status) return null;
    out.status = status;
  }
  if ('deadline' in facts) {
    const deadline = reviewFactText(facts.deadline, 10);
    const bounds = deadline ? dateBounds(deadline) : null;
    if (!deadline || deadline.length !== 10 || !bounds || bounds.first !== deadline) return null;
    out.deadline = deadline;
  }
  if ('amount' in facts) {
    const amount = reviewFactText(facts.amount, 120);
    if (!amount) return null;
    out.amount = amount;
  }
  if ('org_name' in facts) {
    const orgName = reviewFactText(facts.org_name, 200);
    if (!orgName) return null;
    out.org_name = orgName;
  }
  if ('program_name' in facts) {
    const programName = reviewFactText(facts.program_name, 200);
    if (!programName) return null;
    out.program_name = programName;
  }
  return out;
}

function decisionSources(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) return null;
  const urls: string[] = [];
  for (const item of value) {
    const url = officialHttpsUrl(item);
    if (!url) return null;
    urls.push(url);
  }
  return urls;
}

function curatorDecideBody(result: DecideResult): Response {
  if (result.status === 200 && result.body.verdict && result.body.proposal) {
    return curatorJson({
      ok: true,
      id: result.body.proposal.id,
      decision: result.body.verdict.decision,
      commit: result.body.commit ?? null,
      state: result.body.proposal.state,
      at: result.body.verdict.at,
    });
  }
  if (result.status === 404) return curatorJson({ error: 'not_found' }, 404);
  if (result.status === 409) return curatorJson({ error: 'conflict', message: 'Already decided.' }, 409);
  return curatorJson(
    { error: 'apply_failed', ...(result.body.reconciliation_hold ? { reconciliation_hold: true } : {}) },
    result.status >= 400 ? result.status : 500
  );
}

async function withWrite(
  request: Request,
  identity: CuratorIdentity,
  payload: unknown,
  deps: CuratorDeps,
  run: () => Promise<Response>
): Promise<Response> {
  const header = idempotencyHeader(request);
  if (!header) return counted(identity, deps, invalid('Idempotency-Key header is required on writes.'));
  const hash = bodyHash(payload);
  const key = `curator_idem:${identity.id}:${createHash('sha256').update(header).digest('hex')}`;
  const at = new Date(deps.now()).toISOString();
  const claim = await deps.idempotency.claim(key, hash, at);
  if (claim === 'mismatch') {
    return curatorJson({ error: 'conflict', message: 'Idempotency-Key was already used with a different request.' }, 409);
  }
  if (claim === 'pending') return curatorJson({ error: 'conflict', message: 'This Idempotency-Key is already in progress.' }, 409);
  if (typeof claim === 'object') return curatorJson(claim.replay.body, claim.replay.status, { 'Idempotent-Replayed': 'true' });

  const budget = deps.gate.consumeWrite(identity.id);
  if ('response' in budget) {
    await deps.idempotency.release(key);
    return budget.response;
  }
  let response: Response;
  try {
    response = await run();
  } catch {
    await deps.idempotency.release(key);
    return curatorJson({ error: 'apply_failed' }, 500);
  }
  const stored = await response.clone().json().catch(() => ({ error: 'apply_failed' }));
  const hold = Boolean(stored && typeof stored === 'object' && (stored as { reconciliation_hold?: boolean }).reconciliation_hold);
  if (response.status >= 500 && !hold) {
    await deps.idempotency.release(key).catch(() => undefined);
    return response;
  }
  await deps.idempotency.finish(key, response.status, stored, hash, at).catch(() => undefined);
  return response;
}

function counted(identity: CuratorIdentity, deps: CuratorDeps, response: Response): Response {
  const budget = deps.gate.consumeWrite(identity.id);
  return 'response' in budget ? budget.response : response;
}

export async function decideCuratorItem(
  request: Request,
  id: string,
  deps: CuratorDeps = defaultCuratorDeps
): Promise<Response> {
  const auth = authorize(request, 'decide', deps);
  if ('response' in auth) return auth.response;
  if (!/^p\d+$/.test(id)) return curatorJson({ error: 'not_found' }, 404);
  const parsed = await readJson(request);
  if ('response' in parsed) return counted(auth.identity, deps, parsed.response);
  const body = objectBody(parsed.value);
  if (!body) return counted(auth.identity, deps, invalid('Request body must be an object.'));
  const fields = Object.keys(body);
  if (fields.some((field) => FORBIDDEN_FIELDS.has(field))) return curatorJson({ error: 'forbidden' }, 403);
  if (fields.some((field) => !DECIDE_FIELDS.has(field))) return counted(auth.identity, deps, invalid('Unknown field in request body.'));
  const decision = body.decision;
  const reason = reasonText(body.reason);
  const sources = decisionSources(body.sources);
  if (decision !== 'approved' && decision !== 'rejected') {
    return counted(auth.identity, deps, invalid('decision must be approved or rejected.'));
  }
  if (!reason) return counted(auth.identity, deps, invalid('A written reason of 8 to 2000 characters is required.'));
  if (!sources) return counted(auth.identity, deps, invalid('sources must be a list of official https URLs.'));

  const existing = await deps.getProposal(id);
  if (!existing) return curatorJson({ error: 'not_found' }, 404);
  if (proposalBlocked(existing)) return curatorJson({ error: 'forbidden' }, 403);

  return withWrite(request, auth.identity, { id, ...body }, deps, async () => {
    try {
      const result = await deps.decide({
        id,
        decision,
        note: reason,
        by: 'curator',
        curator_id: auth.identity.id,
        curator_name: auth.identity.name,
        sources,
      });
      return curatorDecideBody(result);
    } catch {
      return curatorJson({ error: 'apply_failed' }, 500);
    }
  });
}

export async function proposeCuratorItem(request: Request, deps: CuratorDeps = defaultCuratorDeps): Promise<Response> {
  const auth = authorize(request, 'propose', deps);
  if ('response' in auth) return auth.response;
  const parsed = await readJson(request);
  if ('response' in parsed) return counted(auth.identity, deps, parsed.response);
  const body = objectBody(parsed.value);
  if (!body) return counted(auth.identity, deps, invalid('Request body must be an object.'));
  const fields = Object.keys(body);
  if (fields.some((field) => FORBIDDEN_FIELDS.has(field)) || body.kind === 'merge_orgs' || body.kind === 'merge' || body.kind === 'delete') {
    return curatorJson({ error: 'forbidden' }, 403);
  }
  if (fields.some((field) => !PROPOSE_FIELDS.has(field))) return counted(auth.identity, deps, invalid('Unknown field in request body.'));
  const built = buildCuratorProposal(body, auth.identity, deps.loadRegistry(), new Date(deps.now()).toISOString());
  if (!built.ok) return counted(auth.identity, deps, curatorJson(built.body, built.status));
  if (proposalBlocked(built.candidate)) return curatorJson({ error: 'forbidden' }, 403);

  return withWrite(request, auth.identity, body, deps, async () => {
    const { inserted, skipped } = await deps.insertProposals([built.candidate]);
    if (!inserted.length) {
      return curatorJson(
        { error: 'conflict', message: skipped ? 'An equivalent proposal is already on file.' : 'Proposal was not queued.' },
        409
      );
    }
    const proposal = inserted[0];
    const outcome = await autoApplySubmitted(proposal, built.candidate, auth.identity, deps);
    return curatorJson(
      {
        ok: true,
        id: proposal.id,
        type: proposal.type,
        lane: proposal.lane,
        state: outcome.state,
        ...(outcome.auto_apply ? { auto_apply: outcome.auto_apply } : {}),
      },
      201
    );
  });
}

async function autoApplySubmitted(
  proposal: Proposal,
  candidate: RawMinerProposal,
  identity: CuratorIdentity,
  deps: CuratorDeps
): Promise<{ state: Proposal['state']; auto_apply?: { applied: boolean; reason?: string } }> {
  if (!identity.scopes.includes('apply_low_risk')) return { state: proposal.state };
  const edit = readXHandleEdit(candidate.proposed_change);
  if (!edit || !autoApplyAllowList(deps).has('x_handle')) return { state: proposal.state };
  if (!autoApplyIsEnabled(deps)) return { state: proposal.state, auto_apply: { applied: false, reason: 'disabled' } };
  if (edit.clear) return { state: proposal.state, auto_apply: { applied: false, reason: 'clear_not_auto' } };
  const current = orgSocial(deps, edit.orgId);
  const assessed = await assessXHandleApply({
    edit,
    website: current.website,
    oldValue: current.oldValue,
    quotes: candidate.submitted_by?.quotes || [],
    fetchPage: deps.fetchPage ?? fetchEvidencePage,
    keyId: identity.id,
  });
  if (!assessed.ok) return { state: proposal.state, auto_apply: { applied: false, reason: assessed.reason } };
  try {
    const result = await deps.decide({
      id: proposal.id,
      decision: 'approved',
      note: autoApplyNote(candidate.submitted_by?.reason || ''),
      by: 'curator',
      curator_id: identity.id,
      curator_name: identity.name,
      sources: candidate.submitted_by?.sources,
      auto_apply: assessed.audit,
    });
    if (result.status === 200 && result.body.proposal) {
      return { state: result.body.proposal.state, auto_apply: { applied: true } };
    }
  } catch {
    // The queued proposal stays pending for Desk review.
  }
  return { state: proposal.state, auto_apply: { applied: false, reason: 'apply_failed' } };
}

export async function reviewCuratorItem(
  request: Request,
  id: string,
  deps: CuratorDeps = defaultCuratorDeps
): Promise<Response> {
  const auth = authorize(request, 'propose', deps);
  if ('response' in auth) return auth.response;
  if (!/^p\d+$/.test(id)) return curatorJson({ error: 'not_found' }, 404);
  const parsed = await readJson(request);
  if ('response' in parsed) return counted(auth.identity, deps, parsed.response);
  const body = objectBody(parsed.value);
  if (!body) return counted(auth.identity, deps, invalid('Request body must be an object.'));
  const fields = Object.keys(body);
  if (fields.some((field) => FORBIDDEN_FIELDS.has(field))) return curatorJson({ error: 'forbidden' }, 403);
  if (fields.some((field) => !REVIEW_FIELDS.has(field))) return counted(auth.identity, deps, invalid('Unknown field in request body.'));
  const verdict = body.verdict;
  const reason = reviewReason(body.reason);
  const sources = reviewSources(body.sources);
  const facts = reviewFacts(body.facts);
  if (typeof verdict !== 'string' || !REVIEW_VERDICTS.has(verdict)) {
    return counted(auth.identity, deps, invalid('verdict must be approve, reject, or needs_owner.'));
  }
  if (!reason) return counted(auth.identity, deps, invalid('A reason of 1 to 300 characters is required.'));
  if (!sources) return counted(auth.identity, deps, invalid('sources must be 1 to 8 https URLs with a verbatim quote.'));
  if (facts === null) return counted(auth.identity, deps, invalid('facts may only set status, deadline, amount, org_name, and program_name.'));

  const existing = await deps.getProposal(id);
  if (!existing) return curatorJson({ error: 'not_found' }, 404);

  return withWrite(request, auth.identity, { id, ...body }, deps, async () => {
    const review: CuratorReview = {
      verdict: verdict as CuratorReview['verdict'],
      reason,
      sources,
      ...(facts ? { facts } : {}),
      key_id: auth.identity.id,
      key_name: auth.identity.name,
      at: new Date(deps.now()).toISOString(),
    };
    const saved = await deps.saveReview(id, review);
    if (saved.status === 'missing') return curatorJson({ error: 'not_found' }, 404);
    if (saved.status === 'decided') return curatorJson({ error: 'conflict', message: 'Already decided.' }, 409);
    return curatorJson({
      ok: true,
      id: saved.proposal.id,
      state: saved.proposal.state,
      verdict: saved.proposal.curator_review?.verdict ?? review.verdict,
      at: saved.proposal.curator_review?.at ?? review.at,
    });
  });
}

export async function searchCuratorDirectory(request: Request, deps: CuratorDeps = defaultCuratorDeps): Promise<Response> {
  const auth = authorize(request, 'read_queue', deps);
  if ('response' in auth) return auth.response;
  const params = singleParams(new URL(request.url), SEARCH_PARAMS);
  if (!params) return invalid('Unknown or repeated query parameter.');
  const query = params.q?.trim();
  if (!query || query.length < 2 || query.length > 200) return invalid('q must be 2 to 200 characters.');
  if (params.kind && params.kind !== 'orgs' && params.kind !== 'programs') return invalid('kind must be orgs or programs.');
  const page = positiveInt(params.page, 1, 10_000);
  const limit = positiveInt(params.limit, 20, 50);
  if (!page || !limit) return invalid('page and limit must be positive integers.');
  const registry = deps.loadRegistry();
  const hits: DirectoryHit[] = directoryHits(registry, query, params.kind === 'orgs' || params.kind === 'programs' ? params.kind : 'all');
  const offset = (page - 1) * limit;
  return curatorJson({
    data: offset >= hits.length ? [] : hits.slice(offset, offset + limit),
    meta: { total: hits.length, page, limit, next_page: offset + limit < hits.length ? page + 1 : null },
  });
}

export async function decideCuratorBulk(request: Request, deps: CuratorDeps = defaultCuratorDeps): Promise<Response> {
  const auth = authorize(request, ['decide', 'apply_low_risk'], deps);
  if ('response' in auth) return auth.response;
  const parsed = await readJson(request);
  if ('response' in parsed) return counted(auth.identity, deps, parsed.response);
  const body = objectBody(parsed.value);
  if (!body) return counted(auth.identity, deps, invalid('Request body must be an object.'));
  const fields = Object.keys(body);
  if (fields.some((field) => BULK_FORBIDDEN.has(field))) return curatorJson({ error: 'forbidden' }, 403);
  if (fields.some((field) => !BULK_FIELDS.has(field))) return counted(auth.identity, deps, invalid('Unknown field in request body.'));
  const decision = body.decision;
  const reason = reasonText(body.reason);
  const sources = decisionSources(body.sources);
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !/^p\d+$/.test(id))) {
    return counted(auth.identity, deps, invalid(`ids must be 1 to ${BULK_MAX} proposal ids.`));
  }
  if (ids.length < 1 || ids.length > BULK_MAX) {
    return counted(auth.identity, deps, invalid(`ids must be 1 to ${BULK_MAX} proposal ids.`));
  }
  if (new Set(ids).size !== ids.length) return counted(auth.identity, deps, invalid('ids must be unique.'));
  if (decision !== 'approved' && decision !== 'rejected') {
    return counted(auth.identity, deps, invalid('decision must be approved or rejected.'));
  }
  if (!reason) return counted(auth.identity, deps, invalid('A written reason of 8 to 2000 characters is required.'));
  if (!sources) return counted(auth.identity, deps, invalid('sources must be a list of official https URLs.'));

  const canDecide = auth.identity.scopes.includes('decide');
  const canAuto = auth.identity.scopes.includes('apply_low_risk');
  return withWrite(request, auth.identity, { ids, ...body }, deps, async () => {
    const loaded: { id: string; proposal: Proposal | null }[] = [];
    for (const id of ids as string[]) loaded.push({ id, proposal: await deps.getProposal(id) });
    const found = loaded.flatMap((item) => (item.proposal ? [item.proposal] : []));
    const types = new Set(found.map((proposal) => proposal.type));
    if (types.size > 1) return invalid('ids must all be the same proposal type.');
    if (!canDecide) {
      if (!canAuto || !autoApplyIsEnabled(deps) || decision !== 'approved') return curatorJson({ error: 'forbidden' }, 403);
      const allow = autoApplyAllowList(deps);
      if (found.some((proposal) => !readXHandleEdit(proposal.proposed_change) || !allow.has('x_handle'))) {
        return curatorJson({ error: 'forbidden' }, 403);
      }
    }

    const decided: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const item of loaded) {
      if (!item.proposal) {
        failed.push({ id: item.id, error: 'not_found' });
        continue;
      }
      if (item.proposal.state !== 'pending') {
        failed.push({ id: item.id, error: 'already decided' });
        continue;
      }
      if (proposalBlocked(item.proposal)) {
        failed.push({ id: item.id, error: 'forbidden' });
        continue;
      }
      const edit = decision === 'approved' ? readXHandleEdit(item.proposal.proposed_change) : null;
      let audit: Parameters<CuratorDeps['decide']>[0]['auto_apply'] | undefined;
      if (edit) {
        if (!autoApplyAllowList(deps).has('x_handle')) {
          failed.push({ id: item.id, error: 'forbidden' });
          continue;
        }
        if (!autoApplyIsEnabled(deps)) {
          failed.push({ id: item.id, error: 'disabled' });
          continue;
        }
        if (edit.clear) {
          if (!canAuto || !clearHasEvidence(item.proposal, reason)) {
            failed.push({ id: item.id, error: 'forbidden' });
            continue;
          }
          const current = orgSocial(deps, edit.orgId);
          audit = {
            key_id: auth.identity.id,
            fetched_url: null,
            page_hash: null,
            old_value: current.oldValue,
            new_value: null,
          };
        } else {
          const current = orgSocial(deps, edit.orgId);
          const assessed = await assessXHandleApply({
            edit,
            website: current.website,
            oldValue: current.oldValue,
            quotes: item.proposal.submitted_by?.quotes || [],
            fetchPage: deps.fetchPage ?? fetchEvidencePage,
            keyId: auth.identity.id,
          });
          if (!assessed.ok) {
            failed.push({ id: item.id, error: assessed.reason });
            continue;
          }
          audit = assessed.audit;
        }
      }
      try {
        const result = await deps.decide({
          id: item.id,
          decision,
          note: audit ? autoApplyNote(reason) : reason,
          by: 'curator',
          curator_id: auth.identity.id,
          curator_name: auth.identity.name,
          sources,
          ...(audit ? { auto_apply: audit } : {}),
        });
        if (result.status !== 200) {
          failed.push({ id: item.id, error: result.body.error || 'apply_failed' });
          continue;
        }
        decided.push(item.id);
      } catch {
        failed.push({ id: item.id, error: 'apply_failed' });
      }
    }
    return curatorJson({ ok: true, decided, failed });
  });
}

/** Authenticated refusal for deletes, merges, the legacy bulk route, and config edits. */
export async function forbidCurator(request: Request, deps: CuratorDeps = defaultCuratorDeps): Promise<Response> {
  const auth = authorize(request, 'read_queue', deps);
  if ('response' in auth) return auth.response;
  return curatorJson({ error: 'forbidden' }, 403);
}
