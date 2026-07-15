export interface NewProgramSourceHints {
  orgWebsite: string | null;
  applicationUrl: string | null;
  evidenceUrl: string;
  deadline: string | null;
  amount: string | null;
}

/** Keeps organization identity URLs separate from program application URLs. */
export function buildNewProgramSourceFields(hints: NewProgramSourceHints): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const applyUrl = hints.applicationUrl || (hints.deadline ? hints.evidenceUrl : null);
  if (applyUrl) fields.apply_url = applyUrl;

  if (hints.deadline) {
    const round: Record<string, unknown> = {
      name: 'Current call',
      status: 'open',
      closes: hints.deadline,
      source: hints.evidenceUrl,
    };
    if (hints.amount) round.size = hints.amount;
    fields.rounds = [round];
  }

  return fields;
}
