import type { Program } from './types';

/** Legacy mechanism is a mixed vocabulary, not a source of typed v2 terms. */
export const LEGACY_MECHANISMS = {
  grants: { dimension: 'Instrument', label: 'Grants' },
  retro: { dimension: 'Allocation method', label: 'Retroactive' },
  quadratic: { dimension: 'Allocation method', label: 'Quadratic' },
  prize: { dimension: 'Instrument', label: 'Prize' },
  fellowship: { dimension: 'Program format', label: 'Fellowship' },
  incubator: { dimension: 'Program format', label: 'Incubator' },
  rfp: { dimension: 'Solicitation', label: 'RFP' },
  other: { dimension: 'Legacy classification', label: 'Other' },
} satisfies Record<NonNullable<Program['mechanism']>, { dimension: string; label: string }>;

export function legacyClassificationLabel(mechanism: Program['mechanism']): string {
  if (!mechanism) return 'Legacy classification not recorded';
  const fact = LEGACY_MECHANISMS[mechanism];
  return `${fact.dimension}: ${fact.label}`;
}

export const TERM_CLASSIFICATIONS = {
  instruments: 'Instrument',
  capital_forms: 'Capital form',
  allocation_methods: 'Allocation method',
  selection_models: 'Selection',
} as const;

export function classificationLabel(value: string): string {
  return value === 'api_credit' ? 'API credit' : value.replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());
}
