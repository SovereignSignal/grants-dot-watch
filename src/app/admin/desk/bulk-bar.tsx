'use client';

import { useState } from 'react';
import { typeCountsSummary } from '@/proposal-lanes';
import type { QueueProposal } from './desk-types';
import { VerdictActions } from './verdict-actions';

/** Sticky bottom bar, appears only once something is selected — same
 *  hairline discipline as an item, ink-underline actions, no color, no
 *  shadow. Approve confirms first with a plain-language type breakdown —
 *  it's the one action here that writes files and commits immediately, so it
 *  gets a pause; Reject only records a verdict, so it doesn't. */
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
    <div className="sticky bottom-0 z-20 mt-4 border-t-2 border-paper bg-void/95 px-1 py-4 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="coord shrink-0">
          <span className="text-paper">{n} selected</span>
        </span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note…"
          className="min-w-0 flex-1 border-b border-line bg-transparent px-1 py-1 text-[13px] text-paper placeholder:text-faint focus:border-paper focus:outline-none"
        />
        <VerdictActions
          onApprove={handleApprove}
          onReject={handleReject}
          approveLabel={busy ? 'Working…' : `Approve ${n}: set in registry`}
          rejectLabel={busy ? 'Working…' : `Reject ${n}`}
          disabled={busy}
        />
      </div>
    </div>
  );
}
