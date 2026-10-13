import type { Org, Program, Wire } from './types';
import { programFacts } from './program-facts';
import { productDateISO } from './round-state';

export interface ProgramEntry {
  program: Program;
  org: Org | undefined;
  facts: ReturnType<typeof programFacts>;
}

export function collectPrograms(programs: Program[], orgs: Org[], today = productDateISO()): ProgramEntry[] {
  const byOrg = new Map(orgs.map(org => [org.id, org]));
  return programs.filter(program => !program.parent_round).map(program => ({ program, org: byOrg.get(program.org), facts: programFacts(program, today) }));
}

export function queryPrograms(items: ProgramEntry[], filters: {
  q?: string; wire?: string; mechanism?: string; status?: string; method?: string; sort?: string; org?: string;
}): ProgramEntry[] {
  const words = (filters.q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(({ program, org, facts }) => {
    const text = [program.name, program.summary, org?.name, ...(program.rounds || []).map(r => r.name),
      ...Object.values(program.review?.facts || {}).map(f => f.value)].join(' ').toLowerCase();
    return words.every(word => text.includes(word))
      && (!filters.wire || program.wires.includes(filters.wire as Wire))
      && (!filters.mechanism || (program.mechanism || 'other') === filters.mechanism)
      && (!filters.status || program.status === filters.status)
      && (!filters.method || facts.howToApply.value === filters.method)
      && (!filters.org || program.org === filters.org);
  }).sort((a, b) => {
    if (filters.sort !== 'name') {
      const active = Number(b.program.status === 'active') - Number(a.program.status === 'active');
      if (active) return active;
    }
    return a.program.name.localeCompare(b.program.name) || a.program.id.localeCompare(b.program.id);
  });
}
