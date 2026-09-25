import Link from 'next/link';
import { loadRegistry } from '@/lib/registry';
import { collectPrograms, queryPrograms, type ProgramEntry } from '@/lib/program-directory';
import { APPLICATION_METHOD, PROGRAM_STATUS } from '@/lib/program-facts';
import { paginate, parsePage } from '@/lib/pagination';
import { WIRE_LABEL } from '@/lib/format';
import { MECHANISM_LABEL } from '@/components/ledger/labels';
import { param, hrefWith, type Query, type SearchParams } from '@/components/ledger/query';
import { FilterPanel } from './filter-panel';
import { Pager } from '@/components/ledger/pager';

function ProgramCard({ item }: { item: ProgramEntry }) {
  const { program, org, facts } = item;
  return <article className="opportunity-card" data-testid="opportunity-card">
    <div className="opportunity-card-top"><span className="funder-name">{org?.name || program.org}</span></div>
    <div className="opportunity-card-heading"><div className="card-tags">{program.wires.map(wire => <span key={wire} className={`wire-tag wire-${wire}`}>{WIRE_LABEL[wire]}</span>)}<span>{MECHANISM_LABEL[program.mechanism || 'other']}</span></div>
      <h3><Link href={`/programs/${program.id}`}>{program.name}</Link></h3>
    </div>
    <p className="opportunity-description">{program.summary}</p>
    <dl className="opportunity-meta"><div><dt>Status</dt><dd>{facts.status.label}</dd></div><div><dt>How to apply</dt><dd>{facts.howToApply.label}</dd></div></dl>
    <div className="opportunity-card-bottom"><Link href={`/programs/${program.id}`}>Program details and sources</Link></div>
  </article>;
}

export async function OpportunityDirectory({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { programs, orgs } = loadRegistry();
  const all = collectPrograms(programs, orgs);
  const query: Query = { q: param(sp, 'q')?.slice(0, 180), wire: param(sp, 'wire'), mechanism: param(sp, 'mechanism'), status: param(sp, 'status'), method: param(sp, 'method'), sort: param(sp, 'sort') };
  if (!['crypto', 'ai', 'oss'].includes(query.wire || '')) query.wire = undefined;
  if (!Object.hasOwn(PROGRAM_STATUS, query.status || '')) query.status = undefined;
  if (!Object.hasOwn(APPLICATION_METHOD, query.method || '')) query.method = undefined;
  if (!Object.hasOwn(MECHANISM_LABEL, query.mechanism || '')) query.mechanism = undefined;
  if (!['name', 'active'].includes(query.sort || '')) query.sort = undefined;
  const results = queryPrograms(all, query);
  const page = paginate(results, parsePage(param(sp, 'page')), 18);
  const base = '/opportunities';
  const activeCount = programs.filter(program => program.status === 'active').length;
  const subsets = queryPrograms(all, { ...query, status: undefined });
  const tabs = [
    { id: '', label: 'All programs', count: subsets.length },
    ...Object.entries(PROGRAM_STATUS).map(([id, { label }]) => ({ id, label, count: subsets.filter(item => item.program.status === id).length })),
  ];
  const hasFilters = Object.values(query).some(Boolean);
  return <div className="directory-shell">
    <section className="directory-hero"><div className="hero-kicker">From the Grant Wire</div>
      <div className="hero-line"><h1>Grant programs across<br/><em>crypto, AI and open source.</em></h1></div>
      <p>Who funds them, what they fund and how to apply.</p>
      <div className="directory-statline"><span><b>{programs.length.toLocaleString()}</b> programs on file</span><span><b>{activeCount.toLocaleString()}</b> active programs</span><span>Crypto · AI · Open source</span></div>
    </section>
    <div className="directory-body" id="opportunities">
      <aside className="directory-sidebar" aria-label="Program filters"><FilterPanel>
        <div className="filter-group"><h2>Explore by field</h2><Link href={hrefWith(base, query, { wire: undefined })} className={!query.wire ? 'filter-option active' : 'filter-option'} aria-current={!query.wire ? 'true' : undefined}><span>All fields</span><span>{all.length}</span></Link>
          {(['crypto', 'ai', 'oss'] as const).map(wire => <Link key={wire} href={hrefWith(base, query, { wire })} className={query.wire === wire ? 'filter-option active' : 'filter-option'} aria-current={query.wire === wire ? 'true' : undefined}><span><i className={`field-dot field-${wire}`} aria-hidden="true"/>{WIRE_LABEL[wire]}</span><span>{all.filter(item => item.program.wires.includes(wire)).length}</span></Link>)}
        </div>
        <div className="filter-group"><h2>Funding type</h2><Link href={hrefWith(base, query, { mechanism: undefined })} className={!query.mechanism ? 'filter-option active' : 'filter-option'} aria-current={!query.mechanism ? 'true' : undefined}>Any funding type</Link>{Object.entries(MECHANISM_LABEL).map(([id, label]) => <Link key={id} href={hrefWith(base, query, { mechanism: id })} className={query.mechanism === id ? 'filter-option active' : 'filter-option'} aria-current={query.mechanism === id ? 'true' : undefined}>{label}</Link>)}</div>
        <div className="filter-group"><h2>How to apply</h2><Link href={hrefWith(base, query, { method: undefined })} className={!query.method ? 'filter-option active' : 'filter-option'} aria-current={!query.method ? 'true' : undefined}>All application methods</Link>{Object.entries(APPLICATION_METHOD).map(([id, label]) => <Link key={id} className={query.method === id ? 'filter-option active' : 'filter-option'} href={hrefWith(base, query, { method: id })} aria-current={query.method === id ? 'true' : undefined}>{label}</Link>)}</div>
        <div className="sidebar-note"><p>Read the program page for its terms and sources.</p><Link href="/about">How the registry works</Link></div>
      </FilterPanel></aside>
      <section className="directory-results" aria-label="Grant programs">
        <form action={base} className="directory-search" role="search"><label className="sr-only" htmlFor="opportunity-query">Search programs</label><input id="opportunity-query" name="q" type="search" defaultValue={query.q} placeholder="Search by topic, program or funder"/>{Object.entries(query).filter(([key, value]) => key !== 'q' && value).map(([key, value]) => <input key={key} type="hidden" name={key} value={value}/>)}<button type="submit">Search</button></form>
        <nav className="opportunity-tabs" aria-label="Program status">{tabs.map(tab => <Link key={tab.id} href={hrefWith(base, query, { status: tab.id || undefined })} aria-current={(query.status || '') === tab.id ? 'page' : undefined}>{tab.label}<span>{tab.count}</span></Link>)}</nav>
        <div className="results-toolbar"><p aria-live="polite">{page.total ? <><b>{page.start}-{page.end}</b> of {page.total} programs</> : 'No matching programs'}{query.q && <> for <b>“{query.q}”</b></>}</p><div className="sort-links"><span>Sort:</span>{[['active', 'Active first'], ['name', 'A-Z']].map(([sort, label]) => <Link key={sort} href={hrefWith(base, query, { sort: sort === 'active' ? undefined : sort })} aria-current={(query.sort || 'active') === sort ? 'true' : undefined}>{label}</Link>)}</div></div>
        {hasFilters && <div className="active-filters"><Link href={base}>Clear filters</Link></div>}
        {page.items.length ? <div className="opportunity-grid">{page.items.map(item => <ProgramCard key={item.program.id} item={item}/>)}</div> : <div className="directory-empty"><h2>No matching programs</h2><p>Try a broader topic or another field.</p><Link className="primary-link" href={base}>Browse all programs</Link></div>}
        <Pager base={base} query={query} page={page.page} pageCount={page.totalPages}/><p className="directory-footnote">Status describes whether a program is running. Application methods are recorded separately. Read the funder’s terms before applying.</p>
      </section>
    </div>
  </div>;
}
