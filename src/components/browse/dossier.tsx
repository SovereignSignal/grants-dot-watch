// The broadsheet dossier header — kicker + huge serif name + small-caps facts
// row + serif standfirst — per design/mocks/c-orgcard.html's .dossier/.standfirst.
// Shared by org, system, and grantee detail pages; `compact` shrinks it for the
// grantee "mini org card" per the phase-2B brief.
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

/** The right-rail ruled facts panel — serif italic tabular numbers over a
 *  small-caps label, each row separated by a hairline, with an optional
 *  honesty subscript (e.g. "19 of 46 awards carry a public figure"). */
export function FactsPanel({ facts }: { facts: Fact[] }) {
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
