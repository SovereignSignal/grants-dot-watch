import type { Metadata } from 'next';
import Link from 'next/link';
import '@fontsource-variable/bricolage-grotesque/index.css';
import '@fontsource-variable/instrument-sans/index.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './globals.css';
import Search from '@/components/search';
import ThemeToggle from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: { default: 'grants.watch', template: '%s · grants.watch' },
  description: 'The registry of the funding world: systems, organizations, programs, and awards across crypto, AI, and open source.',
};

// Pre-paint theme script — reads the stored choice (or prefers-color-scheme
// on first visit) and sets data-theme on <html> before first paint, so
// there's no light/dark flash. Dark is the default: we only ever write
// data-theme="light".
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('gw-theme');var light=s?s==='light':window.matchMedia('(prefers-color-scheme: light)').matches;if(light){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();`;

const NAV = [
  { href: '/systems', label: 'Systems' },
  { href: '/orgs', label: 'Organizations' },
  { href: '/programs', label: 'Programs' },
  { href: '/awards', label: 'Awards' },
  { href: '/admin/desk', label: 'The Desk' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh flex flex-col">
        <header className="border-b border-line bg-deep/80 backdrop-blur sticky top-0 z-40">
          <div className="mx-auto max-w-6xl px-4 flex flex-wrap items-center gap-x-4 gap-y-2 py-3 md:flex-nowrap md:items-baseline md:gap-6 md:gap-y-0 md:py-0 md:h-14">
            <Link href="/" className="display order-1 text-lg font-semibold tracking-tight shrink-0">
              grants<span className="text-signal">.</span>watch
            </Link>
            <nav
              aria-label="Primary"
              className="order-3 flex w-full gap-4 overflow-x-auto text-sm text-dim self-center md:order-2 md:w-auto"
            >
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-paper whitespace-nowrap transition-colors">
                  {n.label}
                </Link>
              ))}
            </nav>
            <Search className="order-2 md:order-4" />
            <ThemeToggle className="order-2 md:order-5" />
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
