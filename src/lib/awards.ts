import type { Award, Program } from './types';

function normalizedName(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase('en-US') || '';
}

/** Match a curated program ID first, then a funder-scoped exact program name. */
export function awardMatchesProgram(award: Award, program: Program): boolean {
  if (award.funder !== program.org) return false;
  if (award.program === program.id) return true;
  if (award.program) return false;
  return normalizedName(award.program_name) === normalizedName(program.name);
}

export function awardsForProgram(awards: Award[], program: Program): Award[] {
  return awards.filter((award) => awardMatchesProgram(award, program));
}

/** Newest dated evidence first, then deterministic names and keys. */
export function sortAwardsNewest(awards: Award[]): Award[] {
  return [...awards].sort((a, b) => {
    if (a.date && b.date) {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) return byDate;
    } else if (a.date) {
      return -1;
    } else if (b.date) {
      return 1;
    }

    return a.grantee_name.localeCompare(b.grantee_name) || a.key.localeCompare(b.key);
  });
}

export function awardAmountLabel(award: Award): string {
  if (award.amount_text?.trim()) return award.amount_text.trim();
  if (award.amount == null) return '–';

  const value = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(award.amount);
  const currency = award.currency?.trim().toUpperCase();
  return !currency || currency === 'USD' ? `$${value}` : `${value} ${currency}`;
}
