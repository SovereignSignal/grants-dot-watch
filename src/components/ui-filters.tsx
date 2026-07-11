import Link from 'next/link';

// The one filter/tab primitive for every browse page. Two lanes briefly
// diverged here — src/components/programs/text-filters.tsx (labeled rows,
// text-dim default) and src/components/ledger/chip.tsx + a third copy
// hand-rolled inside src/components/browse/filters.tsx (unlabeled rows,
// text-faint default + a border-line hover hint) — restyling the same old
// pill chips to the same small-caps text voice independently. This file
// folds all three into one: FilterChip's color treatment won (text-faint
// matches the rest of the app's de-emphasized tone — nav links, table cells
// — and the hover:border-line hint previews the active underline before you
// click), FilterLine's labeled-row layout won (more reusable than each page
// hand-building its own label column). No rounded/pill chrome, ever — a
// hairline underline is the only "selected" affordance.

/** A labeled filter row — fixed-width small-caps label, then wrapped
 *  toggles. Rows stack with a hairline between them (border-t, waived on the
 *  first row via first:border-t-0). */
export function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-t border-line py-2.5 first:border-t-0">
      <span className="coord w-[92px] shrink-0 text-faint">{label}</span>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">{children}</div>
    </div>
  );
}

/** An unlabeled wrapped row of toggles — for a page that groups filters by
 *  their own visual content (a wire dot, a bare year) rather than a text
 *  label. */
export function FilterGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">{children}</div>;
}

/** A single toggleable filter — small-caps text with a hairline underline
 *  for the active state, wire-service style (no pill/badge chrome).
 *  Link-based, no client JS. */
export function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`coord border-b pb-0.5 transition-colors ${
        active ? 'border-paper text-paper' : 'border-transparent text-faint hover:border-line hover:text-dim'
      }`}
    >
      {children}
    </Link>
  );
}

/** Announces a filter that arrived via a link from elsewhere (e.g. an org
 *  page) rather than from this row of words — signal-colored underline to
 *  read as "external", with a clear-by-click affordance. */
export function ActiveFilterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="coord inline-flex items-center gap-1.5 border-b border-signal pb-0.5 text-paper hover:text-dim">
      {children}
      <span aria-hidden>✕</span>
    </Link>
  );
}

/** Small-caps tab underline — a heavier border-b-2 sitting on the row's own
 *  bottom hairline (-mb-px) so tabs read as structural, filters (FilterLink,
 *  border-b-1) as optional/removable. Presentational only: callers supply
 *  the element (Link for a route-driven tab, button for client state) and
 *  spread this className in — three call sites shared the exact same
 *  ternary before this (ProgramsTabs, the admin shell's Desk/Health switch,
 *  the Desk's own Judgment/Facts/Log switch). */
export function tabClass(active: boolean): string {
  return `coord -mb-px border-b-2 pb-2.5 pt-1 transition-colors ${
    active ? 'border-paper text-paper' : 'border-transparent text-faint hover:text-dim'
  }`;
}
