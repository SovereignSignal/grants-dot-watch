'use client';

import { WIRE_LABEL } from '@/lib/format';
import type { ProposalType, Wire } from '@/lib/types';
import { PROPOSAL_TYPE_ORDER, TYPE_LABEL } from '@/proposal-lanes';
import type { ConfidenceBand, FilterState } from './desk-types';
import type { QueueProposal } from './desk-types';

const CONFIDENCE_BANDS: { key: ConfidenceBand; label: string }[] = [
  { key: 'all', label: 'All confidence' },
  { key: 'high', label: '80+' },
  { key: 'mid', label: '60–79' },
  { key: 'low', label: '<60' },
];

/** Type chips, wire chips, confidence bands, and a text filter — all derived
 *  from the current pending set so counts on the chips always match what's
 *  actually in the queue right now. */
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
  for (const p of items) {
    typeCounts.set(p.type, (typeCounts.get(p.type) ?? 0) + 1);
    if (p.wire) wireCounts.set(p.wire, (wireCounts.get(p.wire) ?? 0) + 1);
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

  const hasActiveFilters =
    filters.types.size > 0 || filters.wires.size > 0 || filters.confidence !== 'all' || filters.text.trim() !== '';

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <div className="flex flex-wrap gap-1.5">
        {PROPOSAL_TYPE_ORDER.filter((t) => typeCounts.has(t)).map((t) => (
          <Chip key={t} active={filters.types.has(t)} onClick={() => toggleType(t)}>
            {TYPE_LABEL[t]} {typeCounts.get(t)}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {[...wireCounts.keys()].sort().map((w) => (
          <Chip key={w} active={filters.wires.has(w)} onClick={() => toggleWire(w)}>
            {WIRE_LABEL[w]} {wireCounts.get(w)}
          </Chip>
        ))}
        {wireCounts.size > 0 && <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />}
        {CONFIDENCE_BANDS.map((band) => (
          <Chip key={band.key} active={filters.confidence === band.key} onClick={() => onChange({ ...filters, confidence: band.key })}>
            {band.label}
          </Chip>
        ))}
        <input
          type="text"
          value={filters.text}
          onChange={(e) => onChange({ ...filters, text: e.target.value })}
          placeholder="Filter title / org…"
          className="ml-auto min-w-[10rem] rounded border border-line bg-deep px-2 py-1 text-sm text-paper placeholder:text-faint focus:outline-none"
        />
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => onChange({ types: new Set(), wires: new Set(), confidence: 'all', text: '' })}
            className="coord shrink-0 hover:text-dim"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`coord rounded-full border px-2.5 py-1 transition-colors ${
        active ? 'border-signal bg-signal/15 text-paper' : 'border-line text-dim hover:border-faint hover:text-paper'
      }`}
    >
      {children}
    </button>
  );
}
