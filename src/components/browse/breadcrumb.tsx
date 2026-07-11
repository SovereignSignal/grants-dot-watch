// Page-level breadcrumb + edition line, sitting under the global masthead on
// entity detail pages (org/system cards) — the wire-service "dateline"
// row from design/mocks/c-orgcard.html's .byline, adapted: the global layout
// already carries the registry-wide "Registry as of… / Edition …" byline, so
// this is a second, page-scoped row (REGISTRY / ORGANIZATIONS / NAME on the
// left, a short note on the right).
import Link from 'next/link';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumb({ trail, note }: { trail: Crumb[]; note?: string }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-[11px] font-semibold tracking-[.07em] text-faint uppercase">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        {trail.map((c, i) => (
          <span key={i} className="flex items-baseline gap-1.5">
            {i > 0 && (
              <span aria-hidden className="text-line">
                /
              </span>
            )}
            {c.href ? (
              <Link href={c.href} className="hover:text-dim">
                {c.label}
              </Link>
            ) : (
              <span className="font-bold text-dim">{c.label}</span>
            )}
          </span>
        ))}
      </div>
      {note && <span className="shrink-0 normal-case tracking-normal text-faint">{note}</span>}
    </div>
  );
}
