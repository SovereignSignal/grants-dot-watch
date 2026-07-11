import Link from 'next/link';
import type { Wire } from '@/lib/types';
import { WIRE_LABEL } from '@/lib/format';

/** Wire identity mark: colored point + label — identity is never color-alone. */
export function WireBadge({ wire, small }: { wire: Wire; small?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${small ? 'text-[11px]' : 'text-xs'} text-dim`}>
      <span
        aria-hidden
        className="inline-block size-2 rounded-full"
        style={{ background: `var(--color-${wire})` }}
      />
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

export function RoundStatus({ status }: { status: string }) {
  const t = ROUND_TONE[status] || ROUND_TONE.closed;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-dim">
      <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: t.dot }} />
      {t.label}
    </span>
  );
}

export function Coord({ children }: { children: React.ReactNode }) {
  return <span className="coord">{children}</span>;
}

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
  const cls = `block rounded-md border border-line bg-surface p-4 transition-colors ${href ? 'hover:border-faint hover:bg-raised' : ''} ${className}`;
  if (href) return <Link href={href} id={id} className={cls}>{children}</Link>;
  return <div id={id} className={cls}>{children}</div>;
}

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow: string; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 pb-6">
      <div className="coord mb-2">{eyebrow}</div>
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="display text-3xl md:text-4xl font-semibold tracking-tight">{title}</h1>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {sub && <p className="mt-2 max-w-2xl text-dim">{sub}</p>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line p-8 text-center text-dim">{children}</div>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-lg text-paper">{value}</div>
      <div className="coord mt-0.5">{label}</div>
    </div>
  );
}
