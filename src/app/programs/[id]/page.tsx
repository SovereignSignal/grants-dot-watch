import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProgram, loadRegistry } from '@/lib/registry';
import { httpUrl } from '@/lib/opportunities';
import { programFacts, factDate, notedDate, roundHistoryLabel } from '@/lib/program-facts';
import { WIRE_LABEL } from '@/lib/format';
import { MECHANISM_LABEL } from '@/components/ledger/labels';
import { ProgramHistory } from '@/components/programs/program-review';
import { AwardLedger } from '@/components/awards/award-ledger';
import { awardsForProgram } from '@/lib/awards';
import { parsePage } from '@/lib/pagination';
import { param, type SearchParams } from '@/components/ledger/query';
import { pageMetadata } from '@/lib/site-metadata';
import { productDateISO } from '@/lib/round-state';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const p = getProgram(id);
  return pageMetadata(`/programs/${id}`, p?.name || 'Program', p?.summary || 'Funding program and application evidence.');
}

function Source({ url, notedOn }: { url: string | null; notedOn?: string | null }) {
  return <>{url && <a className="evidence-link" href={url} target="_blank" rel="noreferrer">{new URL(url).hostname.replace(/^www\./, '')}</a>}{notedOn && <p className="deadline-note">Noted <time dateTime={notedOn}>{factDate(notedOn)}</time>.</p>}</>;
}

export default async function ProgramPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const program = getProgram(id); if (!program) notFound();
  const registry = loadRegistry();
  const today = productDateISO();
  const facts = programFacts(program, today);
  const deadline = facts.nextDeadline;
  const org = registry.orgs.find(org => org.id === program.org);
  const review = program.review;
  const apply = httpUrl(program.apply_url);
  const sources = [...new Set(program.sources || [])].map(httpUrl).filter((url): url is string => !!url);
  const children = registry.programs.filter(p => p.parent === id);
  const rounds = [...(program.rounds || [])].sort((a, b) => (b.closes || b.opens || '').localeCompare(a.closes || a.opens || ''));
  return <article className="program-dossier">
    <nav className="dossier-breadcrumb" aria-label="Breadcrumb"><Link href="/programs">Programs</Link><span>/</span>{program.wires.map(wire => <Link key={wire} href={`/opportunities?wire=${wire}`}>{WIRE_LABEL[wire]}</Link>)}<span>/</span>{org ? <Link href={`/orgs/${org.id}`}>{org.name}</Link> : program.org}</nav>
    <div className="dossier-grid">
      <header className="dossier-hero"><p className="dossier-kicker"><span className={`wire-square field-${program.wires[0]}`} aria-hidden/>{org?.name || program.org} · {program.wires.map(wire => WIRE_LABEL[wire]).join(' · ')} · {MECHANISM_LABEL[program.mechanism || 'other']}</p><h1>{program.name}</h1><p className="dossier-summary">{program.summary}</p></header>
      <div className="dossier-main">
      <section><h2>Who can apply</h2><dl className="dossier-facts">
        {([['eligibility', 'Eligibility'], ['geography', 'Location'], ['funding', 'Funding']] as const).map(([key, label]) => {
          const fact = review?.facts?.[key];
          return <div key={key}><dt>{label}</dt><dd>{fact?.value || "Not recorded. Check the funder's terms."}{fact && <Source url={httpUrl(fact.source)} notedOn={notedDate(fact.checked_on, today)}/>}</dd></div>;
        })}
      </dl></section>
      <section><h2>Round history</h2>{rounds.length ? <div className="round-history"><table><thead><tr><th>Round</th><th>Window</th><th>Size</th><th>Source</th></tr></thead><tbody>{rounds.map((round, i) => <tr key={`${round.name}-${i}`}>
        <th scope="row">{round.name}</th><td>{round.opens && round.closes ? `${factDate(round.opens)} to ${factDate(round.closes)}` : round.closes ? `Deadline: ${factDate(round.closes)}` : round.opens ? `From ${factDate(round.opens)}` : 'Dates not recorded'}<span className="round-history-state">{roundHistoryLabel(round, today)}</span></td><td>{round.size || 'Not stated'}</td><td>{httpUrl(round.source) ? <a href={round.source} target="_blank" rel="noreferrer" aria-label={`Source for ${round.name}`}>{new URL(round.source!).hostname.replace(/^www\./, '')}</a> : 'Not recorded'}</td>
      </tr>)}</tbody></table></div> : <p>No rounds on file.</p>}<p className="deadline-note">Past rounds stay on the page, so you can see how often this program opens.</p></section>
      {(program.parent || children.length > 0) && <section><h2>Related programs</h2>{program.parent && <Link className="evidence-link" href={`/programs/${program.parent}`}>Parent program</Link>}{children.map(child => <Link className="evidence-link block" href={`/programs/${child.id}`} key={child.id}>{child.name}</Link>)}</section>}
      <ProgramHistory program={program}/>
      <section id="sources"><h2>Sources</h2><ol className="dossier-sources">{sources.map((source, i) => <li key={source}><span>{String(i + 1).padStart(2, '0')}</span><a href={source} target="_blank" rel="noreferrer">{new URL(source).hostname.replace(/^www\./, '')}<small>{new URL(source).pathname === '/' ? 'Program website' : new URL(source).pathname}</small></a></li>)}</ol></section>
    </div><aside className="application-panel" aria-label="The facts"><div className="application-panel-inner"><h2 className="hero-kicker">The facts</h2><dl>
      <div><dt>Status</dt><dd>{facts.status.label}<p className="deadline-note">{facts.status.note}</p><Source url={facts.status.source}/></dd></div>
      <div><dt>How to apply</dt><dd>{facts.howToApply.label}<p className="deadline-note">{facts.howToApply.note}</p><Source url={facts.howToApply.source}/></dd></div>
      <div><dt>Next deadline</dt><dd>{deadline ? <time dateTime={deadline.date}>{deadline.label}</time> : 'No deadline on file'}{deadline && <>{deadline.time && <p className="deadline-time">{deadline.time}</p>}<p className="deadline-note">Published by {org?.name || program.org} for {deadline.round.name}.</p><Source url={deadline.source} notedOn={deadline.notedOn}/>{!deadline.source && <p className="deadline-note">Source not recorded.</p>}</>}</dd></div>
    </dl>
      {apply ? <a className="primary-link" href={apply} target="_blank" rel="noreferrer">Apply on {new URL(apply).hostname.replace(/^www\./, '')}</a> : <p className="application-footnote">Application link not recorded. See the funder’s site.</p>}
      <p className="application-footnote">You apply with the funder. grants.watch does not take applications.</p>
    </div>{org && <section className="dossier-funder"><h2>Funder</h2><Link className="funder-title" href={`/orgs/${org.id}`}>{org.name}</Link><p>{org.systems.map(id => registry.systems.find(system => system.id === id)?.name).filter(Boolean).join(' · ')}</p><Link className="ledger-link" href={`/orgs/${org.id}#programs`}>All {org.name} programs</Link></section>}</aside></div>
    <AwardLedger awards={awardsForProgram(registry.awards, program)} requestedPage={parsePage(param(sp, 'awardPage'))} basePath={`/programs/${id}`} programs={registry.programs} orgIds={new Set(registry.orgs.map(o => o.id))} showProgram={false}/>
  </article>;
}
