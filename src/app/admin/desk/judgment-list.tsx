'use client';

import { useState } from 'react';
import { dateShort } from '../../../lib/format';
import { InkCheckbox } from './ink-checkbox';
import { judgmentDeadline } from './judgment-queue';
import { ProposalCard } from './proposal-card';
import { reviewBrief } from './review-brief';
import { TYPE_SLUG_LABEL } from './desk-voice';
import type { QueueProposal } from './desk-types';

/** Compact queue rows: enough to approve or reject, with the full card behind Record. */
export function JudgmentList({
  items,
  selected,
  focusedId,
  errors,
  disabled,
  onToggleSelect,
  onToggleSelectAll,
  onFocus,
  onDecide,
  onRejectNote,
  rejectNotes,
}: {
  items: QueueProposal[];
  selected: Set<string>;
  focusedId: string | null;
  errors: Record<string, string>;
  disabled?: boolean;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onFocus: (id: string) => void;
  onDecide: (id: string, decision: 'approved' | 'rejected', note?: string) => void;
  onRejectNote: (id: string, note: string) => void;
  rejectNotes: Record<string, string>;
}) {
  const ids = items.map((item) => item.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = !allSelected && ids.some((id) => selected.has(id));

  return (
    <div data-testid="judgment-list">
      <div className="flex items-center gap-2 border-b border-paper py-2">
        <InkCheckbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={() => onToggleSelectAll(ids)}
          label="Select all in the judgment list"
        />
        <span className="coord">Select</span>
      </div>
      {items.map((proposal) => (
        <JudgmentRow
          key={proposal.id}
          proposal={proposal}
          selected={selected.has(proposal.id)}
          focused={focusedId === proposal.id}
          errorMessage={errors[proposal.id]}
          disabled={disabled}
          rejectNote={rejectNotes[proposal.id] ?? ''}
          onToggleSelect={() => onToggleSelect(proposal.id)}
          onFocus={() => onFocus(proposal.id)}
          onDecide={onDecide}
          onRejectNote={onRejectNote}
        />
      ))}
    </div>
  );
}

function JudgmentRow({
  proposal,
  selected,
  focused,
  errorMessage,
  disabled,
  rejectNote,
  onToggleSelect,
  onFocus,
  onDecide,
  onRejectNote,
}: {
  proposal: QueueProposal;
  selected: boolean;
  focused: boolean;
  errorMessage?: string;
  disabled?: boolean;
  rejectNote: string;
  onToggleSelect: () => void;
  onFocus: () => void;
  onDecide: (id: string, decision: 'approved' | 'rejected', note?: string) => void;
  onRejectNote: (id: string, note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const brief = reviewBrief(proposal);
  const facts = Object.fromEntries(brief.facts.map((fact) => [fact.label, fact.value]));
  const org = facts.Org && facts.Org !== 'Not on file' ? facts.Org : null;
  const deadline = judgmentDeadline(proposal);
  const domain = brief.sources[0]?.domain;
  const button =
    'inline-flex min-h-11 flex-1 items-center justify-center px-2 font-sans text-[12px] font-bold tracking-[.08em] uppercase disabled:opacity-40';

  return (
    <article
      id={`proposal-${proposal.id}`}
      data-testid="judgment-row"
      className={`border-b border-line border-l-2 py-3 pl-2 ${focused ? 'border-l-paper' : 'border-l-transparent'}`}
      onClick={onFocus}
    >
      <div className="flex items-start gap-2">
        <span className="pt-1" onClick={(event) => event.stopPropagation()}>
          <InkCheckbox checked={selected} onChange={onToggleSelect} label={`Select ${brief.title}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="min-w-0 text-[16px] leading-tight text-paper">{brief.title}</h3>
            {proposal.confidence != null && <span className="coord shrink-0">Score {proposal.confidence}</span>}
          </div>
          <p className="mt-0.5 truncate text-[13px] text-dim">
            {org || 'No org'}
            <span className="text-faint"> · {TYPE_SLUG_LABEL[proposal.type]}</span>
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="inline-flex shrink-0 items-center rounded-full border border-paper px-2 py-0.5 font-sans text-[10px] font-bold tracking-[.06em] text-paper uppercase">
              {brief.pill}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-dim" title={brief.reason}>
              {brief.reason}
            </span>
          </div>
          <p className="mt-1 truncate text-[13px] text-paper">
            {domain || 'Unsourced'}
            {facts.Status ? ` · ${facts.Status}` : ''}
            {deadline ? ` · ${dateShort(deadline)}` : ''}
          </p>
        </div>
      </div>

      {errorMessage && (
        <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-closing" title={errorMessage}>
          Could not decide: {errorMessage}
        </p>
      )}

      <div className="mt-2 flex gap-2" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={`${button} bg-paper text-void`}
          disabled={disabled}
          onClick={() => onDecide(proposal.id, 'approved')}
        >
          Approve
        </button>
        <button
          type="button"
          className={`${button} border border-paper bg-void text-paper`}
          disabled={disabled}
          onClick={() => setRejectOpen((value) => !value)}
        >
          Reject
        </button>
        <button
          type="button"
          className="inline-flex min-h-11 shrink-0 items-center justify-center border border-line px-3 font-sans text-[12px] font-bold tracking-[.08em] text-dim uppercase"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide' : 'Record'}
        </button>
      </div>

      {rejectOpen && (
        <div className="mt-2 border border-paper p-3" data-testid="reject-sheet" onClick={(event) => event.stopPropagation()}>
          <label className="coord mb-1 block" htmlFor={`reject-note-${proposal.id}`}>
            Reject reason, optional
          </label>
          <input
            id={`reject-note-${proposal.id}`}
            type="text"
            value={rejectNote}
            onChange={(event) => onRejectNote(proposal.id, event.target.value)}
            placeholder="Why reject, if you want it on the log"
            className="mb-3 w-full border-b border-line bg-transparent px-1 py-2 text-[15px] text-paper placeholder:text-faint focus:border-paper focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setRejectOpen(false);
                onDecide(proposal.id, 'rejected', rejectNote.trim() || undefined);
              }}
              className={`${button} bg-paper text-void`}
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => setRejectOpen(false)}
              className={`${button} border border-paper text-paper`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="mt-2" onClick={(event) => event.stopPropagation()}>
          <ProposalCard proposal={proposal} onDecide={onDecide} showActions={false} detailsOnly />
        </div>
      )}
    </article>
  );
}
