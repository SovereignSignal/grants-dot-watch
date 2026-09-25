import Link from 'next/link';
import type { Program } from '@/lib/types';
import { programFacts } from '@/lib/program-facts';

export function ProgramHistory({ program }: { program: Program }) {
  const history = program.review?.history;
  if (!history?.length) return null;
  return <section className="mt-10" aria-labelledby="program-history">
    <h2 id="program-history" className="border-b border-paper pb-2 text-sm font-bold uppercase tracking-wide">What changed</h2>
    <ol>{[...history].sort((a,b) => b.date.localeCompare(a.date)).map(e => <li key={`${e.date}:${e.label}`} className="grid gap-2 border-b border-line py-5 sm:grid-cols-[8rem_1fr]">
      <time dateTime={e.date} className="font-mono text-xs text-faint">{e.date}</time>
      <div><h3 className="font-semibold">{e.label}</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-dim">{e.summary}</p><a href={e.source} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm underline decoration-line underline-offset-4">Source ↗</a></div>
    </li>)}</ol>
  </section>;
}

export function ReviewedPrograms({ programs }: { programs: Program[] }) {
  const groups = [
    {name:'Current programs', items:programs.filter(p=>p.review?.kind!=='unresolved' && p.review?.relationship!=='former')},
    {name:'Former association', items:programs.filter(p=>p.review?.relationship==='former')},
    {name:'Records awaiting identification', items:programs.filter(p=>p.review?.kind==='unresolved')},
  ];
  return <div>{groups.filter(g=>g.items.length).map(group=><div key={group.name} className="mt-6">
    <h3 className="text-xs font-semibold uppercase tracking-wider text-faint">{group.name}</h3>
    {[...group.items].sort((a,b)=>Number(b.status === 'active') - Number(a.status === 'active')||a.name.localeCompare(b.name)).map(p=>{
      const facts=programFacts(p);
      return <article key={p.id} className="grid gap-4 border-b border-line py-5 md:grid-cols-[1.05fr_1.6fr_1fr]">
        <div><Link href={`/programs/${p.id}`} className="display text-2xl text-paper hover:underline">{p.name}</Link><p className="mt-2 text-sm font-semibold text-dim">Status: {facts.status.label}</p></div>
        <p className="text-sm leading-relaxed text-dim">{p.summary}</p>
        <div className="text-sm text-dim"><p>How to apply: {facts.howToApply.label}</p><Link href={`/programs/${p.id}`} className="mt-3 inline-block underline decoration-line underline-offset-4">Details & evidence →</Link></div>
      </article>;
    })}
  </div>)}</div>;
}
