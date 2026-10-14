'use client';

import { WIRE_LABEL } from '@/lib/format';
import type { ProposalType, Wire } from '@/lib/types';
import { PROPOSAL_TYPE_ORDER } from '@/proposal-lanes';
import { TYPE_SLUG_LABEL } from './desk-voice';
import { proposerLabel, reviewBrief } from './review-brief';
import type { ConfidenceBand, CuratorVerdictFilter, FilterState, SourceFilter } from './desk-types';
import type { QueueProposal } from './desk-types';

const VERDICT_FILTERS: { key: CuratorVerdictFilter; label: string }[] = [
  { key: 'all', label: 'All verdicts' },
  { key: 'approve', label: 'Curator approve' },
  { key: 'reject', label: 'Curator reject' },
  { key: 'needs_owner', label: 'Needs owner' },
  { key: 'unreviewed', label: 'Unreviewed' },
];

const SOURCE_FILTERS: { key: SourceFilter; label: string }[] = [
  { key: 'all', label: 'All sources' },
  { key: 'sourced', label: 'Has source' },
  { key: 'unsourced', label: 'Unsourced' },
];

const CONFIDENCE_BANDS: { key: ConfidenceBand; label: string }[] = [
  { key: 'all', label: 'All source scores' },
  { key: 'high', label: 'Score 80+' },
  { key: 'mid', label: 'Score 60 to 79' },
  { key: 'low', label: 'Score <60' },
];

/** Type words, wire words, source-score bands, and a text filter — telegraphic
 *  small caps on a single hairline, no pill chrome. Counts are derived from
 *  the current pending set so they always match what's actually in the
 *  queue right now. */
export function FiltersBar({
  items,
  filters,
  onChange,
}: {
  items: QueueProposal[];
  filters: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const typeCounts = new Map<ProposalType, number>();
  const wireCounts = new Map<Wire, number>();
  const proposerCounts = new Map<string, number>();
  let sourced = 0;
  for (const p of items) {
    typeCounts.set(p.type, (typeCounts.get(p.type) ?? 0) + 1);
    if (p.wire) wireCounts.set(p.wire, (wireCounts.get(p.wire) ?? 0) + 1);
    const who = proposerLabel(p);
    proposerCounts.set(who, (proposerCounts.get(who) ?? 0) + 1);
    if (reviewBrief(p).sources.length > 0) sourced += 1;
  }

  function toggleType(t: ProposalType) {
    const next = new Set(filters.types);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onChange({ ...filters, types: next });
  }

  function toggleWire(w: Wire) {
    const next = new Set(filters.wires);
    if (next.has(w)) next.delete(w);
    else next.add(w);
    onChange({ ...filters, wires: next });
  }

  function toggleProposer(name: string) {
    const next = new Set(filters.proposers);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange({ ...filters, proposers: next });
  }

  const hasActiveFilters =
    filters.types.size > 0 ||
    filters.wires.size > 0 ||
    filters.confidence !== 'all' ||
    filters.source !== 'all' ||
    filters.curator !== 'all' ||
    filters.proposers.size > 0 ||
    filters.text.trim() !== '';

  return (
    <div className="mb-6 border-t border-b border-line py-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        {PROPOSAL_TYPE_ORDER.filter((t) => typeCounts.has(t)).map((t) => (
          <Word key={t} active={filters.types.has(t)} onClick={() => toggleType(t)}>
            {TYPE_SLUG_LABEL[t]} {typeCounts.get(t)}
          </Word>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {[...wireCounts.keys()].sort().map((w) => (
          <Word key={w} active={filters.wires.has(w)} onClick={() => toggleWire(w)}>
            {WIRE_LABEL[w]} {wireCounts.get(w)}
          </Word>
        ))}
        {wireCounts.size > 0 && <span className="h-3 w-px bg-line" aria-hidden />}
        {CONFIDENCE_BANDS.map((band) => (
          <Word key={band.key} active={filters.confidence === band.key} onClick={() => onChange({ ...filters, confidence: band.key })}>
            {band.label}
          </Word>
        ))}
        {wireCounts.size > 0 && <span className="h-3 w-px bg-line" aria-hidden />}
        {VERDICT_FILTERS.map((band) => (
          <Word key={band.key} active={filters.curator === band.key} onClick={() => onChange({ ...filters, curator: band.key })}>
            {band.label}
          </Word>
        ))}
        <span className="h-3 w-px bg-line" aria-hidden />
        {SOURCE_FILTERS.map((band) => (
          <Word key={band.key} active={filters.source === band.key} onClick={() => onChange({ ...filters, source: band.key })}>
            {band.key === 'sourced' ? `Has source ${sourced}` : band.key === 'unsourced' ? `Unsourced ${items.length - sourced}` : band.label}
          </Word>
        ))}
        <input
          type="text"
          value={filters.text}
          onChange={(e) => onChange({ ...filters, text: e.target.value })}
          placeholder="Filter title / org…"
          className="ml-auto min-w-[10rem] flex-1 border-b border-line bg-transparent px-1 py-1 text-[13px] text-paper placeholder:text-faint focus:border-paper focus:outline-none sm:flex-none"
        />
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() =>
              onChange({ types: new Set(), wires: new Set(), confidence: 'all', source: 'all', curator: 'all', proposers: new Set(), text: '' })
            }
            className="coord shrink-0 underline decoration-line underline-offset-2 hover:text-dim"
          >
            Clear
          </button>
        )}
      </div>
      {proposerCounts.size > 0 && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          {[...proposerCounts.keys()].sort().map((name) => (
            <Word key={name} active={filters.proposers.has(name)} onClick={() => toggleProposer(name)}>
              {name} {proposerCounts.get(name)}
            </Word>
          ))}
        </div>
      )}
    </div>
  );
}

function Word({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`coord ${active ? 'text-paper underline decoration-paper underline-offset-[3px]' : 'text-faint hover:text-dim'}`}
    >
      {children}
    </button>
  );
}
