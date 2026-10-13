/** An explicit, reviewed compatibility link. Never infer identity from titles or URLs. */
export function programRoundReferenceErrors(programs) {
  const byId = new Map(programs.map(program => [program.id, program]));
  const errors = [];
  for (const program of programs) {
    if (program.parent_round == null) continue;
    const parent = byId.get(program.parent);
    if (typeof program.parent_round !== 'string' || !program.parent_round.trim() || program.parent_round.length > 300)
      errors.push(`${program.id}: parent_round must be an exact round name`);
    if (!parent || parent.id === program.id || parent.parent_round != null || parent.org !== program.org)
      errors.push(`${program.id}: parent_round requires an enduring parent with the same organization`);
    if ((parent?.rounds || []).filter(round => round.name === program.parent_round).length !== 1)
      errors.push(`${program.id}: parent_round must resolve to exactly one parent round`);
    if ((program.rounds || []).length !== 1)
      errors.push(`${program.id}: a preserved call page must retain exactly one original round`);
  }
  return errors;
}
