import Link from 'next/link';
import Search from '@/components/search';
import { loadRegistry } from '@/lib/registry';
import { dateShort } from '@/lib/format';
import { activeProgramsByOrg, notedDate } from '@/lib/program-facts';
import { awardAmountLabel, sortAwardsNewest } from '@/lib/awards';
import { productDateISO } from '@/lib/round-state';

const WIRES = [
  { id: 'crypto', name: 'Crypto', label: 'crypto', description: 'Protocol foundations, DAOs and ecosystem funds.' },
  { id: 'ai', name: 'AI', label: 'AI', description: 'Public agencies, labs and philanthropies funding AI research and safety.' },
  { id: 'oss', name: 'Open source', label: 'open source', description: 'Foundations and public funds for open software and infrastructure.' },
] as const;
const MECHANISMS = [
  ['grants', 'Grants', 'Money for a proposed project, agreed before the work starts.'],
  ['fellowship', 'Fellowships', 'Funding for a person, usually over a fixed term.'],
  ['rfp', 'Requests for proposals', 'The funder names a problem and invites proposals to solve it.'],
  ['incubator', 'Incubators', 'Funding plus hands-on support to start a project or company.'],
  ['prize', 'Prizes', 'Awards for results, judged against a stated challenge.'],
  ['retro', 'Retro funding', 'Rewards for work already done and shown to be useful.'],
  ['quadratic', 'Quadratic funding', 'A matching pool, shared out by how many people back each project.'],
  ['other', 'Other support', 'Investment, token incentives and arrangements that mix several of these.'],
] as const;

// Adapted from Claude's approved design/mocks/ledger-evergreen/front-page.html.
// Registry records supply every list and count in the original design.
export default function Home() {
  const registry = loadRegistry();
  const active = registry.programs.filter(program => program.status === 'active');
  const ecosystems = registry.systems.map(system => ({
    ...system, count: (registry.bySystem.get(system.id)?.programs || []).filter(program => program.status === 'active').length,
  })).filter(system => system.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const awards = sortAwardsNewest(registry.awards.filter(award =>
    notedDate(award.date || undefined, productDateISO()),
  )).slice(0, 4);
  const ecosystemRow = (system: typeof ecosystems[number]) => <Link className="ecosystem-row" href={`/systems/${system.id}`} key={system.id}>
    <span>{system.name}</span><span>{system.count}</span>
  </Link>;

  return <div className="ledger-shell ledger-home">
    <div className="masthead-byline"><span>The registry of the funding world</span><span>Crypto · AI · Open source</span></div>
    <section className="ledger-hero">
      <div>
        <p className="ledger-kicker">From the Grant Wire</p>
        <h1>The registry of the funding world.</h1>
        <p className="ledger-deck">Grant programs across crypto, AI and open source: who funds them, what they fund and how to apply.<span className="desktop-deck"> Every fact links to its source.</span></p>
        <Search label={`Search ${registry.programs.length.toLocaleString()} programs and ${registry.orgs.length.toLocaleString()} organizations`}/>
      </div>
      <aside className="register-box" aria-label="The register">
        <h2>The register</h2>
        <dl>{[
          [active.length, 'Active programs'],
          [registry.orgs.length, 'Organizations'],
          [registry.systems.length, 'Ecosystems'],
          [registry.awards.length, 'Awards'],
        ].map(([count, label]) => <div key={label}><dt>{label}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl>
      </aside>
    </section>
    <section className="ledger-wires" aria-label="The three wires">
      {WIRES.map(wire => {
        const programs = active.filter(program => program.wires.includes(wire.id));
        const counts = activeProgramsByOrg(programs);
        const funders = registry.orgs.filter(org => counts.has(org.id)).sort((a, b) => counts.get(b.id)! - counts.get(a.id)! || a.name.localeCompare(b.name)).slice(0, 4);
        const href = `/programs?wire=${wire.id}&status=active`;
        return <article className="ledger-wire" key={wire.id}>
          <p className="wire-kicker"><span className={`wire-square field-${wire.id}`} aria-hidden/>The {wire.label} wire</p>
          <h2><Link href={href}><span className={`wire-square mobile-wire-square field-${wire.id}`} aria-hidden/>{wire.name}</Link></h2>
          <p className="wire-description">{wire.description}</p>
          <p className="wire-count"><span>{programs.length}</span><span>active programs</span></p>
          <p className="wire-funders"><span>Most programs</span><br/>{funders.map((org, i) => <span key={org.id}>{i > 0 && ', '}<Link href={`/orgs/${org.id}`}>{org.name}</Link></span>)}</p>
          <Link className="ledger-link wire-browse" href={href}>Browse {wire.label} programs</Link>
        </article>;
      })}
      <p className="mobile-wire-note">Active programs per wire</p>
    </section>
    <div className="ledger-middle">
      <section className="ledger-ecosystems">
        <div className="ledger-section-head"><h2>Funding ecosystems</h2><span>Active programs</span></div>
        <p className="ecosystems-intro">Some funding gathers around a blockchain. Some gathers around a field of work. Each ecosystem page lists its funders and their programs.</p>
        <div className="ecosystem-columns">{([['protocol-ecosystem', 'Protocol ecosystems'], ['funding-domain', 'Funding areas']] as const).map(([kind, label]) => <div key={kind}>
          <h3>{label}</h3>{ecosystems.filter(system => system.kind === kind).map(ecosystemRow)}
        </div>)}</div>
        <div className="mobile-ecosystems">{ecosystems.slice(0, 7).map(ecosystemRow)}</div>
        <Link className="ledger-link ecosystems-all" href="/systems">All {registry.systems.length} ecosystems</Link>
      </section>
      <aside className="ledger-sidebar">
        <section><div className="ledger-section-head"><h2>Latest recorded awards</h2></div>
          <ol className="latest-awards">{awards.map(award => <li key={award.key}>
            <p><time dateTime={award.date!}>{dateShort(award.date)}</time> · {award.funder_name}</p>
            <div><Link href={`/awards?${new URLSearchParams({ q: award.grantee_name, funder: award.funder })}`}>{award.grantee_name}</Link><span>{awardAmountLabel(award)}</span></div>
          </li>)}</ol>
          <Link className="ledger-link" href="/awards">The awards ledger</Link>
        </section>
        <section><div className="ledger-section-head"><h2>How to read a program</h2></div><p className="program-reading-note">Each program page gives three facts: whether the program is running, how it takes applications, and its next published deadline. Each fact links to the page it came from.</p></section>
      </aside>
    </div>
    <section className="funding-methods">
      <div className="ledger-section-head"><h2>Ways to be funded</h2><span>Active programs of each kind</span></div>
      <div className="mechanism-grid">{MECHANISMS.map(([mechanism, label, description]) => <Link key={mechanism} href={`/programs?status=active&mechanism=${mechanism}`}>
        <div><h3>{label}</h3><span>{active.filter(program => (program.mechanism || 'other') === mechanism).length}</span></div><p>{description}</p>
      </Link>)}</div>
    </section>
  </div>;
}
