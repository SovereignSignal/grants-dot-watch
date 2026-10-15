import type { Metadata } from 'next';
import Link from 'next/link';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource-variable/instrument-sans/index.css';
import '@/brand/fonts/fonts.css';
import '@/brand/tokens.css';
import './globals.css';
import SiteHeader from '@/components/site-header';
import { SovereignSignalEndorsement } from '@/components/sovereign-signal-endorsement';
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
  // The card image itself is src/app/opengraph-image.png (Next picks it up by file name).
  twitter: {
    card: 'summary_large_image',
    title: 'grants.watch',
    description: SITE_DESCRIPTION,
  },
};

// Applies a saved theme before first paint. With nothing saved, tokens.css follows
// the system setting. The browser chrome tint follows whichever paper is showing;
// the toggle keeps it in sync after hydration. Same key and attribute as the
// sovereignsignal.com site.
const THEME_BOOT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}
try{var p=getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();var m=document.querySelector('meta[name="theme-color"]');if(p&&m)m.setAttribute("content",p)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#F3EFE6" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <footer className="ledger-shell ledger-footer">
          <Link href="/"><span className="footer-mark" aria-hidden />grants.watch · The registry of the funding world</Link>
          <span className="footer-credits"><span>A Grant Wire publication</span><SovereignSignalEndorsement /></span>
        </footer>
      </body>
    </html>
  );
}
