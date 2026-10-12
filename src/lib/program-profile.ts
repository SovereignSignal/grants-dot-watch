import type { Program } from './types';
import { httpUrl } from './opportunities';
import { factDate, notedDate } from './program-facts';
import { fundingAmountLabel } from './funding-display';
import { productDateISO } from './round-state';

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const words = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
export type ProfileEntry = { scope: string; values: string[]; source: string | null; notedOn: string | null; note?: string };

/** Enrich the existing profile from accepted public terms. Every recorded scope
 * stays separate: a historical cohort or an observation is never current intake. */
export function programProfileFields(program: Program, terms: Row[], today = productDateISO()) {
  const records = terms.filter(row => row.program === program.id);
  const conditions = records.some(row => words(row.eligibility).length || words(row.requirements).length);
  return ([['eligibility', 'Eligibility'], ['geography', 'Location'], ['funding', 'Funding']] as const).map(([key, label]) => {
    const entries: ProfileEntry[] = [];
    const fact = program.review?.facts?.[key];
    if (fact?.value) entries.push({ scope: 'Recorded program fact', values: [fact.value], source: httpUrl(fact.source), notedOn: notedDate(fact.checked_on, today) });
    for (const row of records) {
      let values: string[];
      if (key === 'funding') {
        values = (Array.isArray(row.resources) ? row.resources : []).flatMap(resource => {
          const r = object(resource), value = object(r.value);
          const kind = text(r.kind).replaceAll('_', ' ');
          const description = fundingAmountLabel(value);
          return [`${description}${kind ? ` (${kind})` : ''}`, ...words(r.restrictions)];
        });
      } else {
        values = key === 'eligibility' ? [...words(row.eligibility), ...words(row.requirements)] : words(row.geography);
      }
      if (!values.length) continue;
      const scope = [text(row.round_name) || 'Recorded terms', text(row.effective_from) && `from ${factDate(text(row.effective_from))}`, text(row.effective_to) && `through ${factDate(text(row.effective_to))}`].filter(Boolean).join(' · ');
      const replaced = records.some(replacement => replacement.supersedes_key === row.id && (!text(replacement.effective_from) || text(replacement.effective_from) <= today));
      const note = replaced ? 'Earlier terms. A replacement is recorded in the funding evidence.'
        : row.evidence_state === 'disputed' ? 'Disputed evidence. Check the source and recorded evidence scope.'
        : row.evidence_state === 'recipient_reported' ? 'Recipient-reported evidence.'
        : row.evidence_state === 'unknown' ? 'Evidence support is not established. Check the source.' : undefined;
      entries.push({ scope, values, source: httpUrl(row.source), notedOn: notedDate(text(row.checked_on), today), note });
    }
    // Round sizes are already shown in round history. Use that same sourced
    // value when no terms describe funding, keeping each round named.
    if (key === 'funding' && entries.length === 0) for (const round of program.rounds || []) {
      if (round.size) entries.push({ scope: round.name, values: [round.size], source: httpUrl(round.source), notedOn: null });
    }
    const missing = key === 'geography' && conditions
      ? 'Location is not recorded separately. See the eligibility requirements above.'
      : `No separate ${label.toLowerCase()} field is recorded. Check the program summary and the funder's terms.`;
    return { key, label, entries, missing };
  });
}
