// App Router 404 — reached for any unmatched route.
import Link from 'next/link';
import { PageHeader } from '@/components/ui';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/orgs', label: 'Organizations' },
  { href: '/galaxy', label: 'Galaxy' },
];

export default function NotFound() {
  return (
    <div>
      <PageHeader
        eyebrow="UNCHARTED"
        title="Nothing at these coordinates."
        sub="This page isn't on file. Try one of the charted routes below."
      />
      <div className="mx-auto max-w-6xl px-4 pb-16 flex flex-wrap gap-3">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-md border border-line bg-surface px-4 py-2 text-sm text-paper transition-colors hover:border-faint hover:bg-raised"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
