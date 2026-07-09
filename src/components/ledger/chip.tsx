import Link from 'next/link';

/** A single toggleable filter pill — Link-based, no client JS. */
export function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-faint bg-raised text-paper'
          : 'border-line text-dim hover:border-faint hover:text-paper'
      }`}
    >
      {children}
    </Link>
  );
}

/** A pill announcing a filter that arrived via a link (e.g. from an org page), with an X to clear it. */
export function ActiveFilterChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-xs text-paper transition-colors hover:border-signal/70"
    >
      {children}
      <span aria-hidden>✕</span>
    </Link>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
