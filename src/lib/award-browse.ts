import type { Award, Wire } from './types';

export interface AwardFilterState {
  q?: string;
  wire?: string;
  year?: string;
  currency?: string;
  funder?: string;
}

export function filterAwards(awards: Award[], filters: AwardFilterState): Award[] {
  let rows = awards;

  if (filters.wire) rows = rows.filter((award) => award.wire === (filters.wire as Wire));
  if (filters.year) {
    rows = rows.filter((award) => (filters.year === 'undated' ? !award.date : award.date?.slice(0, 4) === filters.year));
  }
  if (filters.currency) {
    rows = rows.filter((award) => {
      if (filters.currency === 'unspecified') return !award.currency;
      return award.currency?.toUpperCase() === filters.currency?.toUpperCase();
    });
  }
  if (filters.funder) rows = rows.filter((award) => award.funder === filters.funder);
  if (filters.q?.trim()) {
    const needle = filters.q.trim().toLocaleLowerCase('en-US');
    rows = rows.filter((award) =>
      [award.grantee_name, award.grantee, award.funder_name, award.funder, award.program_name, award.program]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase('en-US').includes(needle))
    );
  }

  return rows;
}
