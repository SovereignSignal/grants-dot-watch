'use client';

import { useState } from 'react';
import { typeCountsSummary } from '@/proposal-lanes';
import type { QueueProposal } from './desk-types';

/** Sticky bottom bar, appears only once something is selected. Approve
 *  confirms first with a plain-language type breakdown — it's the one action
 *  in The Desk that writes files and commits immediately, so it gets a pause;
 *  Reject only records a verdict, so it doesn't. */
export function BulkBar({
  selectedProposals,
  onApprove,
  onReject,
  busy,
}: {
  selectedProposals: QueueProposal[];
  onApprove: (note?: string) => void;
  onReject: (note?: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState('');
  const n = selectedProposals.length;
  if (n === 0) return null;

  function handleApprove() {
    const summary = typeCountsSummary(selectedProposals.map((p) => p.type));
    const proceed = window.confirm(
      `You are approving ${n} item${n === 1 ? '' : 's'}${summary ? `: ${summary}` : ''}.\n\n` +
        `This writes the registry files and commits, right now. Proceed?`
    );
    if (!proceed) return;
    onApprove(note.trim() || undefined);
    setNote('');
  }

  function handleReject() {
    onReject(note.trim() || undefined);
    setNote('');
  }

  return (
    <div className="sticky bottom-0 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-md border border-line bg-raised/95 px-4 py-3 shadow-lg backdrop-blur">
      <span className="coord shrink-0">{n} selected</span>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note…"
        className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1.5 text-sm text-paper placeholder:text-faint focus:outline-none"
      />
      <button
        type="button"
        onClick={handleApprove}
        disabled={busy}
        className="min-h-9 shrink-0 rounded-md border border-live bg-live/15 px-3 text-sm font-medium text-live disabled:opacity-50"
      >
        {busy ? 'Working…' : `Approve ${n}`}
      </button>
      <button
        type="button"
        onClick={handleReject}
        disabled={busy}
        className="min-h-9 shrink-0 rounded-md border border-line px-3 text-sm font-medium text-dim disabled:opacity-50"
      >
        {busy ? 'Working…' : `Reject ${n}`}
      </button>
    </div>
  );
}
