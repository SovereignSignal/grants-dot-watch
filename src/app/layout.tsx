import type { Metadata } from 'next';
import Link from 'next/link';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/400-italic.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/500-italic.css';
import '@fontsource-variable/instrument-sans/index.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './globals.css';
import Search from '@/components/search';
import ThemeToggle from '@/components/theme-toggle';
import { loadRegistry } from '@/lib/registry';
import { WIRE_LABEL, dateLong, editionCode } from '@/lib/format';
import type { Wire } from '@/lib/types';

export const metadata: Metadata = {
  title: { default: 'grants.watch', template: '%s · grants.watch' },
  description: 'The registry of the funding world: systems, organizations, and programs across crypto, AI, and open source.',
};

// Pre-paint theme script — reads the stored choice (or prefers-color-scheme
// on first visit) and sets data-theme on <html> before first render, so
// there's no light/dark flash. Light is the default: we only ever write
// data-theme="dark" (or "light" to explicitly override a dark system
// preference — see theme-toggle.tsx).
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('gw-theme');if(s==='dark'){document.documentElement.setAttribute('data-theme','dark');}else if(s==='light'){document.documentElement.setAttribute('data-theme','light');}else if(window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;

const NAV = [
  { href: '/programs', label: 'Now Open' },
  { href: '/systems', label: 'Systems' },
  { href: '/orgs', label: 'Organizations' },
  { href: '/admin/desk', label: 'The Desk' },
];

const WIRES: Wire[] = ['crypto', 'ai', 'oss'];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { counts, loadedAt } = loadRegistry();

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh flex flex-col">
        <header className="sticky top-0 z-40 bg-void">
          <div className="mx-auto max-w-6xl px-4 pt-5 md:pt-6">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-3">
              <Link href="/" className="flex shrink-0 items-baseline gap-2.5">
                <span aria-hidden className="mb-px inline-block size-[10px] bg-paper" />
                <span className="text-[21px] font-extrabold tracking-tight text-paper md:text-[24px]">
                  grants<span className="font-semibold text-faint">.watch</span>
                </span>
                <span className="coord ml-0.5 hidden whitespace-nowrap border-l border-line pl-2 sm:inline-flex">
                  The Registry of the Funding World
                </span>
              </Link>
              <div className="flex w-full items-center gap-4 md:w-auto md:gap-6">
                <nav aria-label="Primary" className="coord no-scrollbar flex min-w-0 flex-1 gap-5 overflow-x-auto md:flex-initial md:gap-7">
                  {NAV.map((n) => (
                    <Link key={n.href} href={n.href} className="whitespace-nowrap transition-colors hover:text-paper">
                      {n.label}
                    </Link>
                  ))}
                </nav>
                <Search className="shrink-0" />
                <ThemeToggle className="shrink-0" />
              </div>
            </div>
            <div className="rule-heavy" />
            <div className="flex flex-col gap-1 border-b border-line py-2 text-[11px] uppercase tracking-[.07em] text-faint sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span>
                Registry as of <b className="font-bold text-dim">{dateLong(loadedAt)}</b> · {counts.orgs.toLocaleString()}{' '}
                organizations tracked
              </span>
              <span>
                <b className="font-bold text-dim">Edition {editionCode(loadedAt)}</b>{' '}
                · Sourced &amp; linked, updated continuously
              </span>
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-16">
          <div className="mx-auto max-w-6xl px-4 py-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
            <span className="coord">the registry of the funding world</span>
            <div className="flex shrink-0 items-center gap-4">
              {WIRES.map((w) => (
                <span key={w} className="coord flex items-center gap-1.5">
                  <span aria-hidden className="inline-block size-1.5" style={{ background: `var(--color-${w})` }} />
                  {WIRE_LABEL[w]}
                </span>
              ))}
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
