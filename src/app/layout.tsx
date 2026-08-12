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
import { publicSiteOrigin } from '@/lib/site-metadata';

export const dynamic = 'force-dynamic';

const SITE_DESCRIPTION = 'The registry of the funding world: systems, organizations, programs, and awards across crypto, AI, and open source.';
const siteOrigin = publicSiteOrigin();

export const metadata: Metadata = {
  ...(siteOrigin ? { metadataBase: siteOrigin, alternates: { canonical: new URL('/', siteOrigin) } } : {}),
  title: { default: 'grants.watch', template: '%s · grants.watch' },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'grants.watch',
    title: 'grants.watch',
    description: SITE_DESCRIPTION,
    ...(siteOrigin ? { url: siteOrigin } : {}),
  },
  twitter: {
    card: 'summary',
    title: 'grants.watch',
    description: SITE_DESCRIPTION,
  },
};

// Pre-paint theme script — reads the stored choice (or prefers-color-scheme
// on first visit) and sets data-theme on <html> before first render, so
// there's no light/dark flash. Light is the default: we only ever write
// data-theme="dark" (or "light" to explicitly override a dark system
// preference — see theme-toggle.tsx).
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('gw-theme');if(s==='dark'){document.documentElement.setAttribute('data-theme','dark');}else if(s==='light'){document.documentElement.setAttribute('data-theme','light');}else if(window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;

const NAV = [
  { href: '/programs', label: 'Now Open', shortLabel: 'Open' },
  { href: '/systems', label: 'Systems', shortLabel: 'Systems' },
  { href: '/orgs', label: 'Organizations', shortLabel: 'Orgs' },
  { href: '/awards', label: 'Awards', shortLabel: 'Awards' },
  { href: '/method', label: 'Method', shortLabel: 'Method', desktopOnly: true },
  { href: '/admin/desk', label: 'The Desk', shortLabel: 'Desk', desktopOnly: true },
];

const WIRES: Wire[] = ['crypto', 'ai', 'oss'];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { counts, updatedAt } = loadRegistry();

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
              <div className="relative flex w-full items-center justify-between gap-1 sm:gap-2 lg:w-auto lg:gap-6">
                <nav
                  aria-label="Primary"
                  className="coord flex items-center gap-1 max-[340px]:text-[10px] max-[340px]:tracking-[.04em] sm:gap-5 lg:gap-7"
                >
                  {NAV.map((n) => (
                    <Link key={n.href} href={n.href} className={`${n.desktopOnly ? 'hidden lg:inline' : ''} whitespace-nowrap transition-colors hover:text-paper`}>
                      <span className="lg:hidden">{n.shortLabel}</span>
                      <span className="hidden lg:inline">{n.label}</span>
                    </Link>
                  ))}
                </nav>
                <Search />
                <ThemeToggle className="shrink-0" />
              </div>
            </div>
            <div className="rule-heavy" />
            <div className="flex flex-col gap-1 border-b border-line py-2 text-[11px] uppercase tracking-[.07em] text-faint sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span>
                Registry loaded <b className="font-bold text-dim">{dateLong(updatedAt)}</b> · {counts.orgs.toLocaleString()} organizations
              </span>
              <span className="hidden sm:inline">
                <b className="font-bold text-dim">Load {editionCode(updatedAt)}</b>{' '}
                · Source-linked public index
              </span>
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-16">
          <div className="mx-auto max-w-6xl px-4 py-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
            <div className="flex min-w-0 flex-col gap-2">
              <span className="coord">the registry of the funding world</span>
              <nav aria-label="About" className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <Link href="/method" className="coord text-dim hover:text-paper">
                  Method
                </Link>
                <a href="https://discuss.watch" className="coord text-dim hover:text-paper">
                  discuss.watch
                </a>
                <a href="https://sovereignsignal.substack.com/" className="coord text-dim hover:text-paper">
                  Sovereign Signal
                </a>
              </nav>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {WIRES.map((w) => (
                <Link key={w} href={`/programs?wire=${w}`} className="coord flex items-center gap-1.5 hover:text-paper">
                  <span aria-hidden className="inline-block size-1.5" style={{ background: `var(--color-${w})` }} />
                  {WIRE_LABEL[w]}
                </Link>
              ))}
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
