import type { Metadata } from 'next';
import Link from 'next/link';
import '@fontsource-variable/newsreader/standard.css';
import '@fontsource-variable/newsreader/standard-italic.css';
import '@fontsource-variable/instrument-sans/index.css';
import '@/brand/tokens.css';
import './globals.css';
import SiteHeader from '@/components/site-header';
import { publicSiteOrigin } from '@/lib/site-metadata';

export const dynamic = 'force-dynamic';

const SITE_DESCRIPTION = 'Find grants, fellowships, prizes and funding across crypto, AI and open source. Researched through Grant Wire, with sources you can follow.';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body className="min-h-dvh flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <footer className="ledger-shell ledger-footer">
          <Link href="/"><span className="footer-mark" aria-hidden />grants.watch · The registry of the funding world</Link>
          <span>A Grant Wire publication</span>
        </footer>
      </body>
    </html>
  );
}
