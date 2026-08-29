import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { liveCounts, apiIndex } from '@/lib/public-api';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata: Metadata = pageMetadata(
  '/query',
  'Query',
  'Read the register as JSON. Same files the site uses. No visit required.'
);

const EXAMPLES = [
  { href: '/api/v1', label: 'Index', note: 'Counts, live board size, and every route' },
  { href: '/api/v1/open', label: 'Open calls', note: 'Dated and standing rounds we can defend today' },
  { href: '/api/v1/open?wire=crypto', label: 'Open, crypto wire', note: 'Same board, one wire' },
  { href: '/api/v1/open?standing=0', label: 'Dated only', note: 'Calls with a published close' },
  { href: '/api/v1/programs?live=1', label: 'Live programs', note: 'Programs with a current round' },
  { href: '/api/v1/orgs?role=funder&wire=ai', label: 'AI funders', note: 'Organization files, filtered' },
  { href: '/api/v1/awards?year=2026&wire=oss', label: '2026 OSS awards', note: 'Append-only ledger rows' },
];

export default function QueryPage() {
  const live = liveCounts();
  const index = apiIndex();

  return (
    <>
      <PageHeader
        eyebrow="THE SUBSTRATE"
        title="Query"
        sub="The register is a set of files. This API is the same reading the site uses. Query it without opening a page."
        right={
          <div className="text-right">
            <div className="serif-statement text-[34px] leading-none tabular-nums text-paper">{live.total}</div>
            <div className="coord mt-1">live calls today</div>
          </div>
        }
      />

      <div className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="max-w-[68ch] space-y-10 text-[15.5px] leading-relaxed text-dim">
            <section>
              <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">What you get</h2>
              <p className="mt-3">
                JSON over the public register: systems, organizations, programs, awards, and the live board.
                Filters are query strings. Lists paginate. Default page size is 50. Maximum is 100. CORS is open
                for GET.
              </p>
              <p className="mt-3">
                A program marked live has a current round: open or announced, and not past its close. Historical
                orgs and programs stay on file. Activity and deadlines are the claims that have to be true today.
              </p>
            </section>

            <section>
              <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">Try these</h2>
              <div className="mt-4 flex flex-col">
                {EXAMPLES.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="group grid grid-cols-1 gap-1 border-b border-line py-3 sm:grid-cols-[220px_1fr] sm:items-baseline sm:gap-6"
                  >
                    <code className="break-all text-[13px] text-paper group-hover:text-signal">{item.href}</code>
                    <span>
                      <span className="text-paper">{item.label}</span>
                      <span className="coord mt-0.5 block">{item.note}</span>
                    </span>
                  </a>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">One request</h2>
              <pre className="mt-3 overflow-x-auto border border-line bg-raised/40 px-4 py-3 text-[13px] leading-relaxed text-paper">
                {`curl -sS https://grants.watch/api/v1/open?wire=oss`}
              </pre>
              <p className="mt-3">
                Replace the host when you run this locally. The path is the contract. Every object includes a
                site <code className="text-paper">href</code> so a briefing and a query stay linked.
              </p>
            </section>
          </div>

          <aside className="min-w-0 lg:border-l lg:border-line lg:pl-11">
            <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
              <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">Live today</h2>
              <span className="coord shrink-0">{index.as_of}</span>
            </div>
            <dl className="mt-2">
              {[
                { label: 'Dated closes', value: live.dated, href: '/api/v1/open?standing=0' },
                { label: 'Standing', value: live.standing, href: '/api/v1/open?standing=1' },
                { label: 'Crypto wire', value: live.crypto, href: '/api/v1/open?wire=crypto' },
                { label: 'AI wire', value: live.ai, href: '/api/v1/open?wire=ai' },
                { label: 'Open source wire', value: live.oss, href: '/api/v1/open?wire=oss' },
              ].map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 border-b border-line py-3">
                  <dt className="text-sm text-dim">{row.label}</dt>
                  <dd>
                    <a href={row.href} className="tabular-nums text-paper hover:text-signal">
                      {row.value}
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-8">
              <div className="border-b-[1.5px] border-paper pb-2">
                <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">On the site</h2>
              </div>
              <nav aria-label="Query shortcuts" className="flex flex-col">
                {[
                  { href: '/', label: 'Today\'s board', note: 'Dated calls on the home page' },
                  { href: '/programs', label: 'Programs', note: 'Full departures board' },
                  { href: '/method', label: 'Method', note: 'How a figure gets on the page' },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group border-b border-line py-4 transition-colors hover:bg-raised/40"
                  >
                    <div className="text-[15px] text-paper group-hover:text-signal">{item.label}</div>
                    <div className="coord mt-1">{item.note}</div>
                  </Link>
                ))}
              </nav>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
