// App Router 404 — reached for any unmatched route.
import Link from 'next/link';
import { PageHeader } from '@/components/ui';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/orgs', label: 'Organizations' },
  { href: '/programs', label: 'Programs' },
];

export default function NotFound() {
  return (
    <div>
      <PageHeader
        eyebrow="NOT FOUND"
        title="Page not found."
        sub="This page isn't on file. Try one of the pages below."
      />
      <div className="mx-auto max-w-6xl px-4 pb-16 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="coord border-b border-line pb-0.5 text-dim transition-colors hover:border-paper hover:text-paper"
          >
            {l.label} →
          </Link>
        ))}
      </div>
    </div>
  );
}
