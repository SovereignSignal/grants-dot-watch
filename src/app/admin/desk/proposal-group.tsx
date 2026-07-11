'use client';

import { useState } from 'react';
import type { ProposalType, Verdict } from '@/lib/types';
import { TYPE_LABEL } from '@/proposal-lanes';
import type { QueueProposal } from './desk-types';
import { ProposalCard } from './proposal-card';

/** One proposal-type section: collapsible, with a count in the header and a
 *  "select all in group" checkbox that reflects partial selection via the
 *  indeterminate state. */
export function ProposalGroup({
  type,
  items,
  selected,
  focusedId,
  errors,
  onToggleSelect,
  onToggleSelectAll,
  onDecided,
}: {
  type: ProposalType;
  items: QueueProposal[];
  selected: Set<string>;
  focusedId: string | null;
  errors: Record<string, string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onDecided: (id: string, decision: 'approved' | 'rejected', verdict: Verdict) => void;
}) {
  const [open, setOpen] = useState(true);
  const ids = items.map((i) => i.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = !allSelected && ids.some((id) => selected.has(id));

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          onChange={() => onToggleSelectAll(ids)}
          aria-label={`Select all in ${TYPE_LABEL[type]}`}
          className="size-4"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="coord flex items-center gap-1.5 hover:text-paper"
        >
          <span aria-hidden>{open ? '▾' : '▸'}</span>
          {TYPE_LABEL[type].toUpperCase()} · {items.length}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-3">
          {items.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              onDecided={onDecided}
              selected={selected.has(p.id)}
              onToggleSelect={() => onToggleSelect(p.id)}
              focused={focusedId === p.id}
              errorMessage={errors[p.id]}
            />
          ))}
        </div>
      )}
    </section>
  );
}
