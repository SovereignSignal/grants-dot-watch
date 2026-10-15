// Page-level breadcrumb under the global masthead on org and system detail
// pages. Same `.dossier-breadcrumb` row as program detail pages: the trail on
// the left, an optional short note on the right.
import Link from 'next/link';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumb({ trail, note }: { trail: Crumb[]; note?: string }) {
  return (
    <nav className="dossier-breadcrumb items-center" aria-label="Breadcrumb">
      {trail.map((c, i) => (
        <span key={i} className="flex items-center gap-2.5">
          {i > 0 && <span aria-hidden>/</span>}
          {c.href ? (
            <Link href={c.href} className="hover:text-dim">
              {c.label}
            </Link>
          ) : (
            <span aria-current="page" className="text-dim">{c.label}</span>
          )}
        </span>
      ))}
      {note && <span className="ml-auto normal-case tracking-normal">{note}</span>}
    </nav>
  );
}
