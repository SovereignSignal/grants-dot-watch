import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata: Metadata = pageMetadata(
  '/method',
  'Method',
  'How grants.watch is organized, and how a figure gets on the page.'
);

export default function MethodPage() {
  return (
    <>
      <PageHeader
        eyebrow="THE REGISTER"
        title="Method"
        sub="How grants.watch is organized, and how a figure gets on the page."
      />
      <div className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="max-w-[68ch] space-y-10 text-[15.5px] leading-relaxed text-dim">
            <section>
              <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">What this is</h2>
              <p className="mt-3">
                grants.watch is a public register of grant funding across crypto, AI, and open source. It tracks
                funding systems, the organizations inside them, the programs those organizations run, and the awards
                those programs have made. Every figure on the site links back to a primary source.
              </p>
            </section>

            <section>
              <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">How the register is organized</h2>
              <p className="mt-3">
                A system is a funding ecosystem with its own capital gravity: a treasury, a foundation, or another
                allocating identity. Ethereum is a system. Crypto is not. Crypto, AI, and open source are wires:
                lenses across the register, not places in it.
              </p>
              <p className="mt-3">
                Organizations are the institutions that fund, receive, or organize capital. Programs are the vehicles
                they run: grant calls, fellowships, prizes, RFPs. Rounds are dated instances of those programs. Awards
                are sourced decisions from a funder to a recipient.
              </p>
            </section>

            <section>
              <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">Where the facts come from</h2>
              <p className="mt-3">
                Signals arrive from public pages and trusted feeds. A deadline can update automatically when the
                funder&apos;s own page states the new date and the change still fits the register&apos;s rules. New
                organizations, new programs, status changes, awards, and how things are classified wait for a person
                to accept them. The canonical record is a set of files. The site is a reading of those files.
              </p>
            </section>

            <section>
              <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">How to query it</h2>
              <p className="mt-3">
                The site is one reading of the files. <Link href="/query" className="border-b border-line text-paper hover:border-paper">GET /api/v1</Link> is
                the same reading as JSON. Use it when you need the register as a data source: open calls,
                an org file, a program, or the awards ledger. You do not have to visit a page.
              </p>
            </section>

            <section>
              <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">What we do not claim</h2>
              <p className="mt-3">
                The register is not a complete map of all funding. It is the set of systems, organizations, programs,
                and awards currently on file, each with a source. Absence means we do not yet have a sourced record,
                not that nothing exists.
              </p>
            </section>
          </div>

          <aside className="min-w-0 lg:border-l lg:border-line lg:pl-11">
            <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
              <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">Start here</h2>
            </div>
            <nav aria-label="Method shortcuts" className="flex flex-col">
              {[
                { href: '/programs', label: 'Open calls', note: 'What closes next' },
                { href: '/query', label: 'Query', note: 'JSON over the same files' },
                { href: '/systems', label: 'Systems', note: 'Funding ecosystems' },
                { href: '/orgs', label: 'Organizations', note: 'Funders and others on file' },
                { href: '/awards', label: 'Awards', note: 'Sourced decisions' },
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
          </aside>
        </div>
      </div>
    </>
  );
}
