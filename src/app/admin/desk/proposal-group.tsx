'use client';

import { useState } from 'react';
import type { ProposalType } from '@/lib/types';
import { TYPE_SLUG_LABEL } from './desk-voice';
import { InkCheckbox } from './ink-checkbox';
import type { QueueProposal } from './desk-types';
import { ProposalCard } from './proposal-card';

/** One proposal-type section: a month-rule style bar (canon: "NEW
 *  ORGANIZATION — 101 ITEMS", matching the home page's Departures group
 *  dividers), collapsible, with a "select all in group" ink checkbox that
 *  reflects partial selection via the indeterminate state. */
export function ProposalGroup({
  type,
  items,
  selected,
  focusedId,
  errors,
  onToggleSelect,
  onToggleSelectAll,
  onDecide,
  onRejectNote,
  rejectNotes,
  disabled,
}: {
  type: ProposalType;
  items: QueueProposal[];
  selected: Set<string>;
  focusedId: string | null;
  errors: Record<string, string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onDecide: (id: string, decision: 'approved' | 'rejected', note?: string) => void;
  onRejectNote: (id: string, note: string) => void;
  rejectNotes: Record<string, string>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const ids = items.map((i) => i.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = !allSelected && ids.some((id) => selected.has(id));

  return (
    <section className="mb-8">
      <div className="flex items-center gap-3.5 border-b-[1.5px] border-paper pb-1.5">
        <InkCheckbox checked={allSelected} indeterminate={someSelected} onChange={() => onToggleSelectAll(ids)} label={`Select all in ${TYPE_SLUG_LABEL[type]}`} />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`proposal-group-${type}`}
          className="flex items-center gap-2 hover:opacity-80"
        >
          <span aria-hidden className="text-[10px] text-faint">
            {open ? '▾' : '▸'}
          </span>
          <span className="text-[11px] font-bold tracking-[.13em] text-paper uppercase whitespace-nowrap">
            {TYPE_SLUG_LABEL[type]}: {items.length} item{items.length === 1 ? '' : 's'}
          </span>
        </button>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
      {open && (
        <div id={`proposal-group-${type}`} className="flex flex-col">
          {items.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              selected={selected.has(p.id)}
              onToggleSelect={() => onToggleSelect(p.id)}
              focused={focusedId === p.id}
              errorMessage={errors[p.id]}
              onDecide={onDecide}
              onRejectNote={onRejectNote}
              rejectNote={rejectNotes[p.id] ?? ''}
              disabled={disabled}
              showActions={false}
            />
          ))}
        </div>
      )}
    </section>
  );
}
