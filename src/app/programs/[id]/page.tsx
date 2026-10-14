import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProgram, loadRegistry } from '@/lib/registry';
import { httpUrl } from '@/lib/opportunities';
import { programFacts, factDate, roundHistoryLabel } from '@/lib/program-facts';
import { WIRE_LABEL } from '@/lib/format';
import { legacyClassificationLabel } from '@/lib/program-classification';
import { ProgramHistory } from '@/components/programs/program-review';
import { AwardLedger } from '@/components/awards/award-ledger';
import { ProgramFunding } from '@/components/funding/program-funding';
import { awardsForProgram } from '@/lib/awards';
import { parsePage } from '@/lib/pagination';
import { param, type SearchParams } from '@/components/ledger/query';
import { pageMetadata } from '@/lib/site-metadata';
import { productDateISO } from '@/lib/round-state';
import { loadPublicFundingProduct } from '@/lib/public-api-v2';
import { roundId } from '@/lib/funding-api.mjs';
import { programProfileFields } from '@/lib/program-profile';

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
  let fundingProduct = null;
  let fundingUnavailable = false;
  try { fundingProduct = await loadPublicFundingProduct(); }
  catch { fundingUnavailable = true; }
  const profileFields = programProfileFields(program, fundingProduct?.collections['program-terms'] || [], today, false, registry.programs);
  const classificationFields = programProfileFields(program, fundingProduct?.collections['program-terms'] || [], today, true, registry.programs);
  const apply = httpUrl(program.apply_url);
  const sources = [...new Set(program.sources || [])].map(httpUrl).filter((url): url is string => !!url);
  const children = registry.programs.filter(p => p.parent === id);
  const enduring = program.parent_round ? registry.programs.find(p => p.id === program.parent) : null;
  const rounds = [...(program.rounds || [])].sort((a, b) => (b.closes || b.opens || '').localeCompare(a.closes || a.opens || ''));
  return <article className="program-dossier">
    <nav className="dossier-breadcrumb" aria-label="Breadcrumb"><Link href="/programs">Programs</Link><span>/</span>{program.wires.map(wire => <Link key={wire} href={`/programs?wire=${wire}`}>{WIRE_LABEL[wire]}</Link>)}<span>/</span>{org ? <Link href={`/orgs/${org.id}`}>{org.name}</Link> : program.org}</nav>
    <div className="dossier-grid">
      <header className="dossier-hero"><p className="dossier-kicker"><span className={`wire-square field-${program.wires[0]}`} aria-hidden/>{org?.name || program.org} · {program.wires.map(wire => WIRE_LABEL[wire]).join(' · ')} · {legacyClassificationLabel(program.mechanism)}</p><h1>{program.name}</h1><p className="dossier-summary">{program.summary}</p></header>
      <div className="dossier-main">
      {enduring && <section aria-label="Preserved call"><h2>Preserved call page</h2><p>This page retains the original call and its evidence. <Link className="evidence-link" href={`/programs/${enduring.id}#${roundId(enduring.id, program.parent_round)}`}>View {program.parent_round} under {enduring.name}</Link>.</p></section>}
      <section><h2>Who can apply</h2><dl className="dossier-facts">
        {profileFields.map(({ key, label, entries, missing }) => <div key={key}><dt>{label}</dt><dd>
          {entries.length ? entries.map((entry, index) => <div key={index} className={index ? 'mt-4' : undefined}>
            <p className="deadline-note">{entry.scope}</p>{entry.values.map((value, i) => <p key={i}>{value}</p>)}
            {entry.note && <p className="deadline-note">{entry.note}</p>}
            <Source url={entry.source} notedOn={entry.notedOn}/>{entry.recordedAt && <Link className="evidence-link block" href={entry.recordedAt}>Evidence on the preserved call page</Link>}
          </div>) : <p>{fundingUnavailable ? 'Additional evidence is temporarily unavailable. Check the recorded summary and sources.' : missing}</p>}
        </dd></div>)}
      </dl></section>
      <section><h2>Funding classification</h2><dl className="dossier-classification dossier-facts">
        {classificationFields.map(({ key, label, entries, missing }) => <div key={key}><dt>{label}</dt><dd>
          {entries.length ? entries.map((entry, index) => <div key={index} className={index ? 'mt-4' : undefined}>
            <p className="deadline-note">{entry.scope}</p>{entry.values.map((value, i) => <p key={i}>{value}</p>)}
            {entry.note && <p className="deadline-note">{entry.note}</p>}
            <Source url={entry.source} notedOn={entry.notedOn}/>{entry.recordedAt && <Link className="evidence-link block" href={entry.recordedAt}>Evidence on the preserved call page</Link>}
          </div>) : <p>{fundingUnavailable ? 'Additional evidence is temporarily unavailable. Check the recorded summary and sources.' : missing}</p>}
        </dd></div>)}
      </dl></section>
      <section><h2>Round history</h2>{rounds.length ? <div className="round-history"><table><thead><tr><th>Round</th><th>Window</th><th>Size</th><th>Source</th></tr></thead><tbody>{rounds.map((round, i) => <tr id={roundId(program.id, round.name)} key={`${round.name}-${i}`}>
        <th scope="row">{round.name}</th><td>{round.opens && round.closes ? `${factDate(round.opens)} to ${factDate(round.closes)}` : round.closes ? `Deadline: ${factDate(round.closes)}` : round.opens ? `From ${factDate(round.opens)}` : 'Dates not recorded'}<span className="round-history-state">{roundHistoryLabel(round, today)}</span></td><td>{round.size || 'Not stated'}</td><td>{httpUrl(round.source) ? <a href={round.source} target="_blank" rel="noreferrer" aria-label={`Source for ${round.name}`}>{new URL(round.source!).hostname.replace(/^www\./, '')}</a> : 'Not recorded'}</td>
      </tr>)}</tbody></table></div> : <p>No rounds on file.</p>}<p className="deadline-note">Past rounds stay on the page, so you can see how often this program opens.</p></section>
      {(program.parent || children.length > 0) && <section><h2>Related programs</h2>{program.parent && <Link className="evidence-link" href={`/programs/${program.parent}`}>Parent program</Link>}{children.map(child => <Link className="evidence-link block" href={`/programs/${child.id}`} key={child.id}>{child.parent_round ? `${child.parent_round} — preserved call page` : child.name}</Link>)}</section>}
      <ProgramHistory program={program}/>
      <ProgramFunding programId={id} product={fundingProduct} unavailable={fundingUnavailable}/>
      <section id="sources"><h2>Sources</h2><ol className="dossier-sources">{sources.map((source, i) => <li key={source}><span>{String(i + 1).padStart(2, '0')}</span><a href={source} target="_blank" rel="noreferrer">{new URL(source).hostname.replace(/^www\./, '')}<small>{new URL(source).pathname === '/' ? 'Program website' : new URL(source).pathname}</small></a></li>)}</ol></section>
    </div><aside className="application-panel" aria-label="The facts"><div className="application-panel-inner"><h2 className="hero-kicker">The facts</h2><dl>
      <div><dt>Status</dt><dd>{facts.status.label}<p className="deadline-note">{facts.status.note}</p><Source url={facts.status.source}/></dd></div>
      <div><dt>How to apply</dt><dd>{facts.howToApply.label}<p className="deadline-note">{facts.howToApply.note}</p><Source url={facts.howToApply.source}/></dd></div>
      <div><dt>Next deadline</dt><dd>{deadline ? <time dateTime={deadline.date}>{deadline.label}</time> : 'No deadline on file'}{deadline && <>{deadline.time && <p className="deadline-time">{deadline.time}</p>}<p className="deadline-note">Published by {org?.name || program.org} for {deadline.round.name}.</p><Source url={deadline.source} notedOn={deadline.notedOn}/>{!deadline.source && <p className="deadline-note">Source not recorded.</p>}</>}</dd></div>
    </dl>
      {apply ? <a className="primary-link main-action" href={apply} target="_blank" rel="noreferrer">Apply on {new URL(apply).hostname.replace(/^www\./, '')}</a> : <p className="application-footnote">Application link not recorded. See the funder’s site.</p>}
      <p className="application-footnote">You apply with the funder. grants.watch does not take applications.</p>
    </div>{org && <section className="dossier-funder"><h2>Funder</h2><Link className="funder-title" href={`/orgs/${org.id}`}>{org.name}</Link><p>{org.systems.map(id => registry.systems.find(system => system.id === id)?.name).filter(Boolean).join(' · ')}</p><Link className="ledger-link" href={`/orgs/${org.id}#programs`}>All {org.name} programs</Link></section>}</aside></div>
    <AwardLedger awards={awardsForProgram(registry.awards, program)} requestedPage={parsePage(param(sp, 'awardPage'))} basePath={`/programs/${id}`} programs={registry.programs} orgIds={new Set(registry.orgs.map(o => o.id))} showProgram={false}/>
  </article>;
}
