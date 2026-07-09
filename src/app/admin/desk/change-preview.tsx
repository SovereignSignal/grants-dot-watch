'use client';

import { useState } from 'react';
import type { FieldDiff, PreviewChange } from './desk-types';
import { clampLines } from './desk-format';

const MAX_LINES = 10;
const MAX_DIFF_ROWS = 5;

/** WHAT, rendered in the card by default: for a create/append this is the
 *  YAML/JSON that will be written, collapsed to ~10 lines; for an update it's
 *  a before→after list of only the fields that change. Either way, no click
 *  is required to see it — only to see the rest of it. */
export function ChangePreview({ changes, notes }: { changes: PreviewChange[]; notes: string[] }) {
  const [openIdx, setOpenIdx] = useState<Record<number, boolean>>({});

  if (changes.length === 0) {
    return (
      <p className="text-xs text-faint">{notes[0] || 'No file changes — this proposal is recorded as a decision only.'}</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {changes.map((c, i) => {
        const isOpen = !!openIdx[i];
        const toggle = () => setOpenIdx((prev) => ({ ...prev, [i]: !isOpen }));
        return (
          <div key={`${c.path}-${i}`}>
            <div className="coord mb-1.5">
              {c.heading} · {c.path}
            </div>
            {c.diff && c.diff.length > 0 ? (
              <DiffBlock diff={c.diff} open={isOpen} onToggle={toggle} />
            ) : (
              <RawBlock content={c.content} open={isOpen} onToggle={toggle} />
            )}
          </div>
        );
      })}
      {notes.length > 0 && (
        <div className="flex flex-col gap-1">
          {notes.map((n, i) => (
            <p key={i} className="text-xs text-faint">
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function RawBlock({ content, open, onToggle }: { content: string; open: boolean; onToggle: () => void }) {
  const trimmed = content.trimEnd();
  const { visible, truncated, totalLines } = clampLines(trimmed, MAX_LINES);
  return (
    <div>
      <pre className="max-h-[28rem] overflow-auto rounded bg-deep p-3 font-mono text-xs text-dim">
        {open ? trimmed : visible}
      </pre>
      {truncated && (
        <button type="button" onClick={onToggle} className="coord mt-1 hover:text-dim">
          {open ? 'Show less' : `Show all ${totalLines} lines`}
        </button>
      )}
    </div>
  );
}

function DiffBlock({ diff, open, onToggle }: { diff: FieldDiff[]; open: boolean; onToggle: () => void }) {
  const rows = open ? diff : diff.slice(0, MAX_DIFF_ROWS);
  const hidden = diff.length - MAX_DIFF_ROWS;
  return (
    <div className="flex flex-col gap-2 rounded border border-line p-2">
      {rows.map((d) => (
        <div key={d.field} className="grid gap-1">
          <div className="coord">{d.field}</div>
          <div
            className="rounded px-2 py-1 font-mono text-xs text-dim"
            style={{ background: 'color-mix(in oklab, var(--color-closing) 14%, transparent)' }}
          >
            − {d.before}
          </div>
          <div
            className="rounded px-2 py-1 font-mono text-xs text-paper"
            style={{ background: 'color-mix(in oklab, var(--color-live) 16%, transparent)' }}
          >
            + {d.after}
          </div>
        </div>
      ))}
      {hidden > 0 && (
        <button type="button" onClick={onToggle} className="coord text-left hover:text-dim">
          {open ? 'Show fewer changed fields' : `Show ${hidden} more changed field${hidden === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}
