'use client';

import { useState } from 'react';
import type { FieldDiff, PreviewChange } from './desk-types';
import { clampLines } from './desk-format';

const MAX_LINES = 10;
const MAX_DIFF_ROWS = 5;

/** WHAT, rendered in the card by default: a thin-ruled mono block headed
 *  "Proposed record" (new file) or "Proposed change" (update), with the
 *  destination path as its first line — for a create/append that's the
 *  YAML/JSON to be written, collapsed to ~10 lines; for an update it's a
 *  before → after line per changed field. No click required to see it, only
 *  to see the rest of a long one. */
export function ChangePreview({ changes, notes }: { changes: PreviewChange[]; notes: string[] }) {
  const [openIdx, setOpenIdx] = useState<Record<number, boolean>>({});

  if (changes.length === 0) {
    return (
      <p className="text-[12.5px] italic text-faint">
        {notes[0] || 'No file changes. This proposal is recorded as a decision only.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {changes.map((c, i) => {
        const isOpen = !!openIdx[i];
        const toggle = () => setOpenIdx((prev) => ({ ...prev, [i]: !isOpen }));
        const label = c.op === 'create' ? 'Proposed record' : 'Proposed change';
        return (
          <div key={`${c.path}-${i}`}>
            <div className="coord mb-1.5">{label}</div>
            {c.diff && c.diff.length > 0 ? (
              <DiffBlock path={c.path} diff={c.diff} open={isOpen} onToggle={toggle} />
            ) : (
              <RawBlock path={c.path} op={c.op} content={c.content} open={isOpen} onToggle={toggle} />
            )}
          </div>
        );
      })}
      {notes.length > 0 && (
        <div className="flex flex-col gap-1">
          {notes.map((n, i) => (
            <p key={i} className="text-[12px] italic text-faint">
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function RawBlock({
  path,
  op,
  content,
  open,
  onToggle,
}: {
  path: string;
  op: PreviewChange['op'];
  content: string;
  open: boolean;
  onToggle: () => void;
}) {
  const trimmed = content.trimEnd();
  const { visible, truncated, totalLines } = clampLines(trimmed, MAX_LINES);
  const lines = (open ? trimmed : visible).split('\n');
  return (
    <div>
      <div className="border-y border-line py-3.5 font-mono text-[12.5px] leading-[1.85]">
        <div className="mb-1 text-faint">
          → {path}
          {op === 'create' && <span className="text-faint"> (new file)</span>}
        </div>
        <div className="max-h-[28rem] overflow-auto">
          {lines.map((ln, i) => (
            <div key={i} className="whitespace-pre text-paper">
              <span className="mr-1.5 text-faint" aria-hidden>
                +
              </span>
              {ln}
            </div>
          ))}
        </div>
      </div>
      {truncated && (
        <button type="button" onClick={onToggle} className="coord mt-1.5 hover:text-dim">
          {open ? 'Show less' : `Show all ${totalLines} lines`}
        </button>
      )}
    </div>
  );
}

function DiffBlock({
  path,
  diff,
  open,
  onToggle,
}: {
  path: string;
  diff: FieldDiff[];
  open: boolean;
  onToggle: () => void;
}) {
  const rows = open ? diff : diff.slice(0, MAX_DIFF_ROWS);
  const hidden = diff.length - MAX_DIFF_ROWS;
  return (
    <div>
      <div className="border-y border-line py-3.5 font-mono text-[12.5px] leading-[1.85]">
        <div className="mb-2 text-faint">→ {path}</div>
        <div className="flex flex-col gap-2.5">
          {rows.map((d) => (
            <div key={d.field}>
              <div className="coord mb-0.5 text-faint">{d.field}</div>
              <div className="whitespace-pre-wrap">
                <span className="text-faint line-through decoration-line">{d.before}</span>
                <span className="mx-2 text-faint" aria-hidden>
                  →
                </span>
                <span className="font-semibold text-signal">{d.after}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {hidden > 0 && (
        <button type="button" onClick={onToggle} className="coord mt-1.5 hover:text-dim">
          {open ? 'Show fewer changed fields' : `Show ${hidden} more changed field${hidden === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}
