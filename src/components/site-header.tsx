'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';

const NAV = [
  ['/programs', 'Programs'], ['/orgs', 'Organizations'], ['/systems', 'Ecosystems'],
  ['/awards', 'Awards'], ['/about', 'About'],
];

export default function SiteHeader() {
  const path = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const links = NAV.map(([href, label]) => <Link key={href} href={href}
    aria-current={path === href || path.startsWith(`${href}/`) ? 'page' : undefined}
    onClick={() => { if (menu.current) menu.current.open = false; }}>{label}</Link>);
  return <header className="ledger-shell ledger-header">
    <div className="masthead">
      <Link href="/" className="wordmark"><span className="brand-mark" aria-hidden/>grants.watch</Link>
      <nav className="desktop-nav" aria-label="Primary">{links}</nav>
      <details ref={menu} className="mobile-menu">
        <summary aria-label="Menu"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M4 7h16M4 12h16M4 17h16"/></svg></summary>
        <nav aria-label="Primary">{links}</nav>
      </details>
    </div>
  </header>;
}
