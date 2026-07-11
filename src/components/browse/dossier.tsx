// The broadsheet dossier header — kicker + huge serif name + small-caps facts
// row + serif standfirst — per design/mocks/c-orgcard.html's .dossier/.standfirst.
// Shared by org and system detail pages; `compact` shrinks it for smaller,
// mini-card-style uses.
import type { ReactNode } from 'react';

export function FactSep() {
  return (
    <span aria-hidden className="text-line">
      ·
    </span>
  );
}

export function Dossier({
  kicker,
  kickerColor,
  name,
  aka,
  factsLine,
  standfirst,
  compact,
}: {
  kicker: string;
  kickerColor?: string;
  name: ReactNode;
  aka?: string;
  factsLine?: ReactNode;
  standfirst?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="mx-auto max-w-6xl border-b border-line px-4 pt-7 pb-6">
      <div className="coord mb-3 flex items-center gap-2">
        {kickerColor && <span aria-hidden className="inline-block size-1.5 shrink-0" style={{ background: kickerColor }} />}
        {kicker}
      </div>
      <h1
        className={`display leading-[0.98] tracking-tight text-paper ${
          compact ? 'text-[30px] md:text-[38px]' : 'text-[38px] md:text-[56px]'
        }`}
      >
        {name}
      </h1>
      {aka && <div className="coord mt-2">aka {aka}</div>}
      {factsLine && (
        <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] font-bold tracking-[.08em] text-dim uppercase">
          {factsLine}
        </div>
      )}
      {standfirst && (
        <div
          className={`serif-statement mt-5 max-w-[68ch] leading-[1.5] font-normal text-paper not-italic ${
            compact ? 'text-[15.5px]' : 'text-[18px] md:text-[20px]'
          }`}
        >
          {standfirst}
        </div>
      )}
    </div>
  );
}

export interface Fact {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}

/** The ruled facts panel — serif italic tabular numbers over a small-caps
 *  label, with an optional honesty subscript for a stat that needs a
 *  caveat. `vertical` (default) stacks rows hairline-separated for a narrow
 *  rail; `horizontal` lays them out side by side under one shared rule, for
 *  a full-width strip when there's no rail to hang them on. */
export function FactsPanel({ facts, layout = 'vertical' }: { facts: Fact[]; layout?: 'vertical' | 'horizontal' }) {
  if (layout === 'horizontal') {
    return (
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3">
        {facts.map((f, i) => (
          <div key={i}>
            <div className="serif-statement text-[32px] leading-none tabular-nums text-paper">{f.value}</div>
            <div className="coord mt-2">{f.label}</div>
            {f.note && <div className="serif-statement mt-1 text-[10.5px] leading-snug text-faint">{f.note}</div>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {facts.map((f, i) => (
        <div key={i} className={`py-5 ${i === 0 ? 'pt-1' : ''} ${i < facts.length - 1 ? 'border-b border-line' : ''}`}>
          <div className="serif-statement text-[32px] leading-none tabular-nums text-paper">{f.value}</div>
          <div className="coord mt-2">{f.label}</div>
          {f.note && <div className="serif-statement mt-1 text-[10.5px] leading-snug text-faint">{f.note}</div>}
        </div>
      ))}
    </div>
  );
}
