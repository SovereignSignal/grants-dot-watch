import Link from 'next/link';
import type { Wire } from '@/lib/types';
import { WIRE_LABEL } from '@/lib/format';

/** Wire identity mark: a 6px square + small-caps label — identity is never
 *  color-alone. */
export function WireBadge({ wire, small }: { wire: Wire; small?: boolean }) {
  return (
    <span className={`coord inline-flex items-center gap-1.5 ${small ? 'text-[10px]' : 'text-[11px]'}`}>
      <span aria-hidden className="inline-block size-1.5 shrink-0" style={{ background: `var(--color-${wire})` }} />
      {WIRE_LABEL[wire]}
    </span>
  );
}

const ROUND_TONE: Record<string, { dot: string; label: string }> = {
  open: { dot: 'var(--color-live)', label: 'Open' },
  announced: { dot: 'var(--color-signal)', label: 'Announced' },
  reviewing: { dot: 'var(--color-closing)', label: 'In review' },
  closed: { dot: 'var(--color-faint)', label: 'Closed' },
  deployed: { dot: 'var(--color-faint)', label: 'Deployed' },
};

/** Round/program status: a plain word next to a colored square. */
export function RoundStatus({ status }: { status: string }) {
  const t = ROUND_TONE[status] || ROUND_TONE.closed;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-paper">
      <span aria-hidden className="inline-block size-1.5 shrink-0" style={{ background: t.dot }} />
      {t.label}
    </span>
  );
}

export function Coord({ children }: { children: React.ReactNode }) {
  return <span className="coord">{children}</span>;
}

/** A borderless row-block: a top hairline instead of a box. The hairline
 *  darkens to full ink on hover for a linked card — no fill, no shadow. */
export function Card({
  href,
  children,
  className = '',
  id,
}: {
  href?: string;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const cls = `block border-t border-line pt-4 pb-4 transition-colors ${href ? 'hover:border-paper' : ''} ${className}`;
  if (href) return <Link href={href} id={id} className={cls}>{children}</Link>;
  return <div id={id} className={cls}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl border-b border-line px-4 pt-10 pb-7">
      <div className="coord mb-3">{eyebrow}</div>
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="display text-4xl leading-[1.05] tracking-tight text-paper md:text-5xl">{title}</h1>
        {right && <div className="ml-auto pb-1">{right}</div>}
      </div>
      {sub && <p className="mt-3 max-w-2xl text-dim">{sub}</p>}
    </div>
  );
}

/** An italic serif one-liner — no box, no dashed border. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="serif-statement py-10 text-center text-lg text-dim">{children}</div>;
}

/** A large serif/italic tabular number over a small-caps label. */
export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="serif-statement text-2xl leading-none tabular-nums text-paper">{value}</div>
      <div className="coord mt-1.5">{label}</div>
    </div>
  );
}
