import type { Metadata } from 'next';
import Link from 'next/link';
import '@fontsource-variable/bricolage-grotesque/index.css';
import '@fontsource-variable/instrument-sans/index.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './globals.css';
import { loadRegistry } from '@/lib/registry';

export const metadata: Metadata = {
  title: { default: 'grants.watch', template: '%s · grants.watch' },
  description: 'The registry of the funding world: systems, organizations, programs, and awards across crypto, AI, and open source.',
};

const NAV = [
  { href: '/systems', label: 'Systems' },
  { href: '/orgs', label: 'Organizations' },
  { href: '/programs', label: 'Programs' },
  { href: '/awards', label: 'Awards' },
  { href: '/galaxy', label: 'Galaxy' },
  { href: '/desk', label: 'The Desk' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { counts } = loadRegistry();
  return (
    <html lang="en">
      <body className="min-h-dvh flex flex-col">
        <header className="border-b border-line bg-deep/80 backdrop-blur sticky top-0 z-40">
          <div className="mx-auto max-w-6xl px-4 flex items-baseline gap-6 h-14">
            <Link href="/" className="display text-lg font-semibold tracking-tight shrink-0">
              grants<span className="text-signal">.</span>watch
            </Link>
            <nav aria-label="Primary" className="flex gap-4 overflow-x-auto text-sm text-dim self-center">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-paper whitespace-nowrap transition-colors">
                  {n.label}
                </Link>
              ))}
            </nav>
            <span className="coord ml-auto hidden md:block">
              {counts.funders} funders · {counts.programs} programs · {counts.awards} awards
            </span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-16">
          <div className="mx-auto max-w-6xl px-4 py-6 flex flex-wrap gap-x-6 gap-y-2 items-baseline">
            <span className="coord">the registry of the funding world</span>
            <span className="coord ml-auto">
              a <a href="https://discuss.watch" className="hover:text-dim">.watch</a> instrument · Sovereign Signal
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
