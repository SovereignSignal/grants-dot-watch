import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getIngestState, setIngestState, insertIngestProposals, listProposals, type RawMinerProposal } from './desk-store';
import { loadRegistry } from './registry';
import { httpUrl, dateBounds } from './evidence-fields';
import type { Program, Wire } from './types';

export interface WireEvidence {
  program_id: number | null; duplicate_of_id: number | null; status: string; classification: string | null; org_id: number | null;
  org_name: string | null; org_website: string | null; org_aliases: string[]; amount: string | null;
  deadline: string | null; deadline_iso: string | null; tags: string[];
  description: string | null; enriched_summary: string | null;
}
export interface Finding {
  id: string; title: string; summary: string; source_url: string | null; observed_at: string;
  source_kind: 'official' | 'social' | 'secondary'; program_id?: string;
  classification?: { label: string; confidence: number; model: string };
  disposition?: { state: 'excluded' | 'duplicate'; reason: string; duplicate_of?: string };
  wire_record?: WireEvidence;
  expected_hash?: string;
  changes?: Partial<Pick<Program, 'summary' | 'status' | 'apply_url' | 'review' | 'rounds'>>;
}
export interface ResearchPacket {
  version: 1; run_id: string; wire: Wire; producer: string; completed_at: string;
  coverage: { provider: string; status: 'complete' | 'failed' | 'skipped'; results: number; cost_usd?: number | null }[];
  findings: Finding[];
}
export interface FindingOutcome {
  id: string; revision: string; title: string; source_url: string | null; program_id?: string;
  state: 'pending_review' | 'queued' | 'excluded' | 'duplicate' | 'unchanged' | 'conflict';
  reason: string; proposal_id?: string; classification?: Finding['classification'];
}
export interface ResearchReport {
  version: 1; run_id: string; wire: Wire; producer: string; completed_at: string;
  packet_hash: string; saved: boolean; coverage: ResearchPacket['coverage']; outcomes: FindingOutcome[];
  findings: Finding[];
  proposals: RawMinerProposal[];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export class ResearchInputError extends Error {}
function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw new ResearchInputError(message); }
function fields(v: Record<string, unknown>, allowed: string[], where: string) {
  requireValue(Object.keys(v).every(k => allowed.includes(k)), `${where} contains unsupported fields`);
}
function text(v: unknown, max = 4000): v is string { return typeof v === 'string' && !!v.trim() && v.length <= max; }
function iso(v: unknown): v is string { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)); }
const slug = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,119}$/.test(v);
const statuses = ['active', 'paused', 'concluded', 'announced', 'unknown'];

export function parseResearchPacket(value: unknown): ResearchPacket {
  requireValue(isObject(value), 'Expected a research packet');
  fields(value, ['version', 'run_id', 'wire', 'producer', 'completed_at', 'coverage', 'findings'], 'Packet');
  requireValue(value.version === 1 && slug(value.run_id), 'Expected version 1 and a run_id slug');
  requireValue(['crypto', 'ai', 'oss'].includes(String(value.wire)) && text(value.producer, 80) && iso(value.completed_at), 'Invalid run metadata');
  requireValue(Array.isArray(value.coverage) && value.coverage.length <= 12, 'Invalid source coverage');
  for (const c of value.coverage) {
    requireValue(isObject(c), 'Invalid coverage entry'); fields(c, ['provider', 'status', 'results', 'cost_usd'], 'Coverage');
    requireValue(text(c.provider, 50) && ['complete', 'failed', 'skipped'].includes(String(c.status)) && Number.isSafeInteger(c.results) && Number(c.results) >= 0, 'Invalid coverage entry');
    requireValue(c.cost_usd == null || (typeof c.cost_usd === 'number' && Number.isFinite(c.cost_usd) && c.cost_usd >= 0), 'Invalid provider cost');
  }
  requireValue(Array.isArray(value.findings) && value.findings.length <= 200, 'A packet may contain up to 200 findings');
  const ids = new Set();
  for (const f of value.findings) {
    requireValue(isObject(f), 'Invalid finding');
    fields(f, ['id', 'title', 'summary', 'source_url', 'observed_at', 'source_kind', 'program_id', 'classification', 'disposition', 'expected_hash', 'changes', 'wire_record'], 'Finding');
    requireValue(text(f.id, 180) && !ids.has(f.id), 'Finding IDs must be nonempty and unique'); ids.add(f.id);
    requireValue(text(f.title, f.wire_record ? 500 : 300) && text(f.summary, 12000) && (f.source_url === null || httpUrl(f.source_url)) && iso(f.observed_at), `Invalid evidence for ${f.id}`);
    requireValue(Date.parse(f.observed_at) <= Date.parse(value.completed_at), 'Finding observation is after run completion');
    requireValue(['official', 'social', 'secondary'].includes(String(f.source_kind)), 'Invalid source kind');
    requireValue(f.program_id == null || slug(f.program_id), 'Invalid program identity');
    if (f.wire_record != null) {
      const r = f.wire_record;
      requireValue(isObject(r) && /^wire:\d+$/.test(String(f.id)), 'Wire evidence needs a stable source ID');
      fields(r, ['program_id', 'duplicate_of_id', 'status', 'classification', 'org_id', 'org_name', 'org_website', 'org_aliases', 'amount', 'deadline', 'deadline_iso', 'tags', 'description', 'enriched_summary'], 'Wire evidence');
      for (const key of ['program_id', 'duplicate_of_id', 'org_id']) requireValue(r[key] === null || (Number.isSafeInteger(r[key]) && Number(r[key]) > 0), 'Invalid Wire identity');
      requireValue(text(r.status, 40), 'Invalid Wire status');
      for (const key of ['classification', 'org_name', 'amount', 'deadline', 'deadline_iso', 'description', 'enriched_summary']) requireValue(r[key] === null || (typeof r[key] === 'string' && r[key].length <= 30000), 'Invalid Wire evidence text');
      requireValue(r.org_website === null || httpUrl(r.org_website), 'Invalid Wire organization URL');
      for (const key of ['org_aliases', 'tags']) requireValue(Array.isArray(r[key]) && r[key].length <= 200 && r[key].every(v => text(v, 500)), 'Invalid Wire evidence list');
    }
    if (f.classification != null) {
      const c = f.classification; requireValue(isObject(c), 'Invalid classification'); fields(c, ['label', 'confidence', 'model'], 'Classification');
      requireValue(['OPPORTUNITY', 'UPDATE', 'AWARD', 'APPLICANT', 'NEWS', 'NOISE'].includes(String(c.label)) && text(c.model, 100)
        && typeof c.confidence === 'number' && Number.isFinite(c.confidence) && c.confidence >= 0 && c.confidence <= 1, 'Invalid Jev classification');
    }
    if (f.disposition != null) {
      const d = f.disposition; requireValue(isObject(d), 'Invalid disposition'); fields(d, ['state', 'reason', 'duplicate_of'], 'Disposition');
      requireValue(['excluded', 'duplicate'].includes(String(d.state)) && text(d.reason), 'Disposition needs a reason');
      requireValue(d.state !== 'duplicate' || text(d.duplicate_of, 180), 'A duplicate needs its original finding reference');
    }
    if (f.changes != null) {
      requireValue(isObject(f.changes) && slug(f.program_id) && typeof f.expected_hash === 'string' && /^[a-f0-9]{64}$/.test(f.expected_hash), 'Changes require a program and its captured SHA-256');
      fields(f.changes, ['summary', 'status', 'apply_url', 'review', 'rounds'], 'Changes');
      requireValue(Object.keys(f.changes).length > 0, 'Changes cannot be empty');
      requireValue(!f.disposition, 'A finding cannot be both changed and excluded/duplicate');
      if (f.changes.summary != null) requireValue(text(f.changes.summary) && f.changes.summary.length >= 40, 'Program summary is too short');
      if (f.changes.status != null) requireValue(statuses.includes(String(f.changes.status)), 'Invalid operating status');
      if (f.changes.apply_url != null) requireValue(httpUrl(f.changes.apply_url), 'Invalid application URL');
      // The full staged registry validator remains authoritative at Desk approval.
      // Only bounded, public-shaped fields are allowed through this intake.
      if (f.changes.rounds != null) {
        requireValue(Array.isArray(f.changes.rounds) && f.changes.rounds.length <= 100, 'Invalid rounds');
        for (const r of f.changes.rounds) {
          requireValue(isObject(r), 'Invalid round'); fields(r, ['name', 'status', 'opens', 'closes', 'closes_at', 'size', 'source'], 'Round');
          requireValue(text(r.name, 200) && ['open', 'announced', 'closed', 'reviewing', 'deployed'].includes(String(r.status)), 'Invalid round');
          for (const key of ['opens', 'closes']) if (r[key] != null) requireValue(typeof r[key] === 'string' && dateBounds(r[key] as string), 'Invalid round date');
          if (r.closes_at != null) requireValue(iso(r.closes_at) && /(?:Z|[+-]\d{2}:\d{2})$/.test(r.closes_at) && r.closes === r.closes_at.slice(0, 10), 'Exact deadline requires its stated date and timezone');
          if (r.size != null) requireValue(text(r.size, 500), 'Invalid funding size');
          if (r.source != null) requireValue(httpUrl(r.source), 'Invalid round source');
        }
      }
      if (f.changes.review != null) {
        const r = f.changes.review; requireValue(isObject(r), 'Invalid review');
        fields(r, ['checked_on', 'review_after', 'operating', 'intake', 'intake_note', 'source', 'kind', 'relationship', 'relationship_note', 'questions', 'history', 'intake_mode', 'round_names', 'facts'], 'Review');
        requireValue(typeof r.checked_on === 'string' && r.checked_on.length === 10 && dateBounds(r.checked_on)
          && typeof r.review_after === 'string' && r.review_after.length === 10 && dateBounds(r.review_after) && r.review_after >= r.checked_on, 'Invalid review dates');
        requireValue(statuses.includes(String(r.operating)) && ['open', 'closed', 'postponed', 'unknown'].includes(String(r.intake))
          && ['program', 'unresolved'].includes(String(r.kind)) && ['current', 'former', 'unconfirmed'].includes(String(r.relationship))
          && httpUrl(r.source) && text(r.intake_note), 'Invalid review assessment');
        requireValue(Array.isArray(r.questions) && r.questions.length <= 30 && r.questions.every(q => text(q, 1000)), 'Invalid review questions');
        requireValue(Array.isArray(r.history) && r.history.length <= 100, 'Invalid review history');
        for (const h of r.history) { requireValue(isObject(h), 'Invalid history'); fields(h, ['date', 'label', 'summary', 'source'], 'History'); requireValue(typeof h.date === 'string' && dateBounds(h.date) && text(h.label, 150) && text(h.summary) && httpUrl(h.source), 'Invalid history evidence'); }
        if (r.round_names != null) requireValue(Array.isArray(r.round_names) && r.round_names.length <= 100 && r.round_names.every(n => text(n, 200)), 'Invalid review scope');
        if (r.relationship_note != null) requireValue(text(r.relationship_note), 'Invalid relationship note');
        if (r.intake_mode != null) requireValue(['rolling', 'rounds', 'unknown'].includes(String(r.intake_mode)), 'Invalid intake mode');
        if (r.facts != null) {
          requireValue(isObject(r.facts), 'Invalid facts'); fields(r.facts, ['eligibility', 'geography', 'funding', 'deadline'], 'Facts');
          for (const fact of Object.values(r.facts)) { requireValue(isObject(fact), 'Invalid fact'); fields(fact, ['value', 'source', 'checked_on'], 'Fact'); requireValue(text(fact.value, 2000) && httpUrl(fact.source) && typeof fact.checked_on === 'string' && fact.checked_on.length === 10 && dateBounds(fact.checked_on), 'Invalid fact evidence'); }
        }
      }
    }
  }
  return value as unknown as ResearchPacket;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export const contentHash = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function findingRevision(f: Finding) { const { observed_at: _observed, ...meaning } = f; void _observed; return contentHash(meaning); }

function signalId(id: string, revision: string): string {
  return /^wire:\d+$/.test(id) ? `${id}:${revision}` : `research:${revision}`;
}

export function prepareResearch(packet: ResearchPacket, programs: Program[], hashes: Record<string, string>): ResearchReport {
  const proposals: RawMinerProposal[] = [];
  const outcomes: FindingOutcome[] = packet.findings.map(f => {
    const revision = findingRevision(f);
    const base = { id: f.id, revision, title: f.title, source_url: f.source_url, ...(f.program_id ? { program_id: f.program_id } : {}), ...(f.classification ? { classification: f.classification } : {}) };
    if (f.disposition) return { ...base, state: f.disposition.state, reason: `${f.disposition.reason}${f.disposition.duplicate_of ? ` (${f.disposition.duplicate_of})` : ''}` };
    const program = programs.find(p => p.id === f.program_id);
    if (f.wire_record && !['queued', 'approved'].includes(f.wire_record.status)) return { ...base, state: 'pending_review', reason: `Source is now ${f.wire_record.status}${f.wire_record.duplicate_of_id ? ` (parent wire:${f.wire_record.duplicate_of_id})` : ''}. Reconsider its previous evidence; public registry records remain unchanged.` };
    if (!program || !f.changes) return { ...base, state: 'pending_review', reason: program ? 'Evidence retained. A sourced correction still needs to be prepared.' : 'Resolve the program identity and prepare a new record or correction.' };
    if (f.expected_hash !== hashes[program.id]) return { ...base, state: 'conflict', reason: 'The program changed since this finding was prepared. Rebase the correction against its current record.' };
    if (f.source_kind !== 'official' || !f.source_url) return { ...base, state: 'pending_review', reason: 'Verify proposed terms against an official program source before queuing a correction.' };
    const { rounds, ...changes } = f.changes;
    const sources = [f.source_url, f.changes.review?.source, ...(rounds || []).map(r => r.source), ...Object.values(f.changes.review?.facts || {}).map(fact => fact.source)].filter((s): s is string => !!s);
    proposals.push({ type: 'profile_note', org: program.org, program: program.name, title: f.title,
      summary: f.summary, evidence_url: f.source_url, signal_id: signalId(f.id, revision), wire: packet.wire,
      proposed_change: { [`programs/${program.id}.yaml`]: { ...changes, ...(rounds ? { rounds_replace: rounds } : {}), sources_add: [...new Set(sources)] }, _expected_content_hashes: { [`programs/${program.id}.yaml`]: hashes[program.id] } },
    });
    return { ...base, state: 'queued', reason: 'Sourced correction prepared for owner review at the Desk.' };
  });
  return { version: 1, run_id: packet.run_id, wire: packet.wire, producer: packet.producer, completed_at: packet.completed_at, packet_hash: contentHash(packet), saved: false, coverage: packet.coverage, findings: packet.findings, outcomes, proposals };
}

export async function ingestResearch(value: unknown, save = false): Promise<ResearchReport> {
  const packet = parseResearchPacket(value);
  requireValue(Date.parse(packet.completed_at) <= Date.now() + 60_000, 'Run completion is in the future');
  const previous = await getIngestState(`research:run:${packet.run_id}`) as ResearchReport | null;
  if (previous) {
    requireValue(previous.packet_hash === contentHash(packet), 'Run ID already belongs to a different packet');
    if (save) await indexResearchReport(previous);
    return previous;
  }
  const { programs } = loadRegistry();
  const hashes = Object.fromEntries(programs.map(p => [p.id, createHash('sha256').update(readFileSync(join(process.cwd(), 'registry/programs', `${p.id}.yaml`))).digest('hex')]));
  const report = prepareResearch(packet, programs, hashes);
  for (const outcome of report.outcomes) {
    if (await getIngestState(`research:seen:${outcome.revision}`)) { outcome.state = 'unchanged'; outcome.reason = 'This exact finding revision is already recorded.'; }
  }
  report.proposals = report.proposals.filter(p => report.outcomes.some(o => o.state === 'queued' && p.signal_id === signalId(o.id, o.revision)));
  if (!save) return report;
  await insertIngestProposals(report.proposals);
  const proposals = await listProposals(undefined, { recoverClaims: false });
  for (const outcome of report.outcomes) {
    const proposal = proposals.find(p => p.signal_id === signalId(outcome.id, outcome.revision));
    if (proposal) outcome.proposal_id = proposal.id;
    else if (outcome.state === 'queued') throw new Error('Research proposal was not persisted');
  }
  // Store the durable run before the replay markers. A retry after a partial
  // write returns the report; proposal signal IDs also prevent double inserts.
  report.saved = true;
  await setIngestState(`research:run:${packet.run_id}`, report);
  await indexResearchReport(report);
  return report;
}

async function indexResearchReport(report: ResearchReport) {
  for (const outcome of report.outcomes) await setIngestState(`research:seen:${outcome.revision}`, { run_id: report.run_id, proposal_id: outcome.proposal_id });
  const runs = await getIngestState('research:runs') as string[] | null;
  await setIngestState('research:runs', [report.run_id, ...(runs || []).filter(id => id !== report.run_id)].slice(0, 50));
}

export async function recentResearch(): Promise<ResearchReport[]> {
  const ids = await getIngestState('research:runs') as string[] | null;
  const runs = await Promise.all((ids || []).map(id => getIngestState(`research:run:${id}`)));
  return runs.filter((r): r is ResearchReport => !!r && typeof r === 'object' && 'outcomes' in r);
}
