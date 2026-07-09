// Label maps for program-level fields not covered by src/lib/format.ts
// (which only knows round status and wires). Kept in the ledger module
// since only programs/awards pages use them.

export const MECHANISM_LABEL: Record<string, string> = {
  grants: 'Grants',
  retro: 'Retroactive',
  quadratic: 'Quadratic',
  prize: 'Prize',
  fellowship: 'Fellowship',
  incubator: 'Incubator',
  rfp: 'RFP',
  other: 'Other',
};

export const PROGRAM_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  concluded: 'Concluded',
  announced: 'Announced',
  unknown: 'Status unknown',
};

/** Tone for a program's own status field (distinct from round status). */
export const PROGRAM_STATUS_TONE: Record<string, string> = {
  active: 'var(--color-live)',
  announced: 'var(--color-signal)',
  paused: 'var(--color-closing)',
  concluded: 'var(--color-faint)',
  unknown: 'var(--color-faint)',
};
