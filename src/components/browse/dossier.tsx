// The detail-page header for org and system pages: kicker, name, small-caps
// facts row and summary, on the same `.dossier-hero` classes as program detail
// pages so all three entity pages share one header.
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
  action,
}: {
  kicker: string;
  kickerColor?: string;
  name: ReactNode;
  aka?: string;
  factsLine?: ReactNode;
  standfirst?: ReactNode;
  /** The screen's one main action (rust), set under the standfirst. */
  action?: ReactNode;
}) {
  return (
    <header className="dossier-hero border-b border-line pt-7 pb-6 md:pt-11">
      <p className="dossier-kicker">
        {kickerColor && <span aria-hidden className="wire-square" style={{ background: kickerColor }} />}
        {kicker}
      </p>
      <h1>{name}</h1>
      {aka && <div className="coord mt-2">aka {aka}</div>}
      {factsLine && (
        <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] font-bold tracking-[.08em] text-dim uppercase">
          {factsLine}
        </div>
      )}
      {standfirst && <div className="dossier-summary max-w-[68ch]">{standfirst}</div>}
      {action && <div className="mt-6">{action}</div>}
    </header>
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
