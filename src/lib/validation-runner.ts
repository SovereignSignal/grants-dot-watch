// The Desk's machine-validation pipeline (docs/DESIGN.md two-lane law,
// graduation clause): runs proposal-validator.ts's deterministic checks
// against every pending proposal, applies + commits the ones that PASS
// exactly the way a human Approve would, and persists a failure record onto
// everything else so it stays pending — the Desk becomes an exception queue.
// No LLM calls anywhere in this file.
import {
  type AppliedChange,
  assertCleanGitPaths,
  commitChange,
  prepareProposalChanges,
  recordPreparedChangeIntent,
  registryMayHaveChanged,
  writePreparedChanges,
} from './committer';
import { claimProposal, listProposals, recordVerdict, releaseProposalClaim, setProposalValidation } from './desk-store';
import { invalidateRegistryCache } from './registry';
import type { Proposal, ProposalType, ProposalValidation } from './types';
import { validateProposal, validateStagedChanges } from './proposal-validator';

// Bounds one run's wall-clock time: FETCH_CONCURRENCY in-flight fetches at
// once, each capped at proposal-validator.ts's 10s timeout, DEFAULT_LIMIT
// proposals per call unless the caller asks for more.
const DEFAULT_LIMIT = 50;
const FETCH_CONCURRENCY = 4;
// Mirrors decide-bulk's "never one commit touching hundreds of files" rule,
// tightened further here since this runs unattended.
const COMMIT_CHUNK_SIZE = 40;

export interface RunValidationOptions {
  limit?: number;
}

interface TypeTally {
  passed: number;
  failed: number;
}

export interface RunValidationResult {
  attempted: number;
  passed: number;
  failed: number;
  skipped: number;
  byType: Partial<Record<ProposalType, TypeTally>>;
  commits: string[];
  errors: { id: string; error: string }[];
}

/** Hand-rolled p-limit: runs `fn` over `items` with at most `limit` in
 *  flight at once, preserving result order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function bump(byType: RunValidationResult['byType'], type: ProposalType, key: keyof TypeTally): void {
  const tally = byType[type] ?? { passed: 0, failed: 0 };
  tally[key]++;
  byType[type] = tally;
}

function passedChecksSummary(validation: ProposalValidation): string {
  const names = validation.checks.filter((c) => c.pass).map((c) => c.name);
  return names.length ? names.join(', ') : '(no checks recorded)';
}

function machineCommitMessage(proposals: Proposal[]): string {
  const header = `Machine validation: ${proposals.length} item${proposals.length === 1 ? '' : 's'} auto-approved`;
  const lines = proposals.map((p) => `- ${p.type}: ${p.title} (${p.id})`);
  return [header, '', ...lines, '', 'Machine-validated: deterministic checks only, no LLM in the loop.'].join('\n');
}

interface Outcome {
  proposal: Proposal;
  validation: ProposalValidation;
  pass: boolean;
}

/** Runs the validator over up to `limit` pending proposals (both lanes) and
 *  applies the ones that pass. Safe to call repeatedly / on a schedule —
 *  every write is staged, durably intent-ledgered on ephemeral production,
 *  atomically written, then committed/verdict-recorded. */
export async function runValidation(opts: RunValidationOptions = {}): Promise<RunValidationResult> {
  const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : DEFAULT_LIMIT;
  // Never-checked proposals come first — otherwise a standing exception list
  // (failures stay pending by design) starves new arrivals of validation.
  // Already-checked items only retry after a cooldown, stalest first, and
  // never-auto classes are excluded from retries (their verdict can't change).
  const RECHECK_COOLDOWN_MS = 20 * 60 * 60 * 1000;
  const now = Date.now();
  const all = await listProposals({ state: 'pending' });
  const unchecked = all.filter((p) => !p.validation);
  const recheckable = all
    .filter((p) => p.validation && !p.validation.never_auto)
    .filter((p) => now - new Date(p.validation!.checked_at).getTime() > RECHECK_COOLDOWN_MS)
    .sort((a, b) => new Date(a.validation!.checked_at).getTime() - new Date(b.validation!.checked_at).getTime());
  const pending = [...unchecked, ...recheckable].slice(0, limit);

  const byType: RunValidationResult['byType'] = {};
  const errors: { id: string; error: string }[] = [];
  let skipped = 0;

  const outcomes = await mapWithConcurrency(pending, FETCH_CONCURRENCY, async (p): Promise<Outcome | null> => {
    try {
      const result = await validateProposal(p);
      const validation: ProposalValidation = {
        checks: result.checks,
        reason: result.reason || (result.pass ? 'passed' : 'unknown'),
        checked_at: new Date().toISOString(),
        ...(result.neverAuto ? { never_auto: true } : {}),
      };
      return { proposal: p, validation, pass: result.pass };
    } catch (e) {
      // validateProposal's own contract is "never throws," but a run must
      // survive an unexpected exception regardless — count it separately
      // from a proper FAIL (which carries checks + a reason) since there's
      // nothing trustworthy to persist here.
      errors.push({ id: p.id, error: e instanceof Error ? e.message : 'validation threw' });
      skipped++;
      return null;
    }
  });

  const passedList: Outcome[] = [];
  const failedList: Outcome[] = [];
  for (const o of outcomes) {
    if (!o) continue;
    (o.pass ? passedList : failedList).push(o);
  }

  // FAIL: persist the check record; proposal stays pending, now visible to
  // the Desk's exception queue with checks + a reason attached.
  for (const { proposal, validation } of failedList) {
    try {
      await setProposalValidation(proposal.id, validation);
      bump(byType, proposal.type, 'failed');
    } catch (e) {
      errors.push({ id: proposal.id, error: e instanceof Error ? e.message : 'failed to persist validation' });
      skipped++;
    }
  }

  // PASS: apply + commit in chunks, then record a machine verdict per item.
  const commits: string[] = [];
  for (let i = 0; i < passedList.length; i += COMMIT_CHUNK_SIZE) {
    const chunk = passedList.slice(i, i + COMMIT_CHUNK_SIZE);
    const allChanges: AppliedChange[] = [];
    const applied: Outcome[] = [];
    const appliedChanges = new Map<string, AppliedChange[]>();
    const appliedNotes = new Map<string, string[]>();
    const dirtySnapshots = new Map<string, string>();
    const claimedPaths = new Set<string>();

    for (const item of chunk) {
      const claimed = await claimProposal(item.proposal.id);
      if (!claimed) {
        errors.push({ id: item.proposal.id, error: 'proposal was claimed or decided during validation' });
        skipped++;
        continue;
      }
      try {
        const prepared = prepareProposalChanges(claimed);
        assertCleanGitPaths(prepared.changes, dirtySnapshots);
        const paths = [...new Set(prepared.changes.map((change) => change.path))];
        const overlap = paths.find((path) => claimedPaths.has(path));
        if (overlap) throw new Error(`${overlap} is already targeted by another proposal in this validation chunk`);
        const stagedError = validateStagedChanges(prepared.changes);
        if (stagedError) {
          const validation: ProposalValidation = {
            checks: [
              ...item.validation.checks,
              { name: 'pre-write-staged-registry-valid', pass: false, detail: stagedError },
            ],
            reason: `registry changed after validation: ${stagedError}`,
            checked_at: new Date().toISOString(),
          };
          await releaseProposalClaim(item.proposal.id, validation);
          bump(byType, item.proposal.type, 'failed');
          errors.push({ id: item.proposal.id, error: `pre-write staged validation failed: ${stagedError}` });
          continue;
        }
        if (process.env.GRANTS_WATCH_NO_GIT === '1') {
          await recordPreparedChangeIntent(prepared, machineCommitMessage([claimed]), claimed.id);
        }
        const { changes, notes } = writePreparedChanges(prepared);
        allChanges.push(...changes);
        for (const change of changes) {
          if (change.content_after !== undefined) dirtySnapshots.set(change.path, change.content_after);
          claimedPaths.add(change.path);
        }
        appliedChanges.set(claimed.id, changes);
        appliedNotes.set(claimed.id, notes);
        applied.push({ ...item, proposal: claimed });
      } catch (e) {
        // Validation passed (including its own dry-run check) but the write
        // still failed — e.g. the registry moved under us mid-run. Fall back
        // to the failure path rather than silently losing the item.
        const detail = e instanceof Error ? e.message : String(e);
        const validation: ProposalValidation = {
          checks: item.validation.checks,
          reason: `dry run passed but apply failed: ${detail}`,
          checked_at: new Date().toISOString(),
        };
        if (!registryMayHaveChanged(e)) await releaseProposalClaim(item.proposal.id, validation);
        bump(byType, item.proposal.type, 'failed');
        errors.push({ id: item.proposal.id, error: `apply failed after passing validation: ${detail}` });
      }
    }

    if (allChanges.length > 0) invalidateRegistryCache();

    const uniquePaths = [...new Set(allChanges.map((c) => c.path))];
    const commit =
      uniquePaths.length === 0 || process.env.GRANTS_WATCH_NO_GIT === '1'
        ? null
        : await commitChange(
            uniquePaths,
            machineCommitMessage(applied.map((a) => a.proposal)),
            applied.map((a) => a.proposal.id).join(','),
            allChanges,
            { recordFallback: false }
          );
    if (commit) commits.push(commit);

    if (uniquePaths.length > 0 && process.env.GRANTS_WATCH_NO_GIT !== '1' && commit === null) {
      for (const item of applied) {
        await recordPreparedChangeIntent(
          {
            changes: appliedChanges.get(item.proposal.id) ?? [],
            notes: appliedNotes.get(item.proposal.id) ?? [],
          },
          machineCommitMessage([item.proposal]),
          item.proposal.id
        );
      }
    }

    for (const item of applied) {
      const changes = appliedChanges.get(item.proposal.id) ?? [];
      try {
        await recordVerdict(item.proposal.id, 'approved', {
          note: `machine-validated: ${passedChecksSummary(item.validation)}`,
          commit,
          by: 'machine',
          from: 'applying',
          ledgerRequired: Boolean(process.env.DATABASE_URL) && changes.length > 0 && commit === null,
        });
        bump(byType, item.proposal.type, 'passed');
      } catch (e) {
        errors.push({ id: item.proposal.id, error: e instanceof Error ? e.message : 'verdict record failed' });
        skipped++;
      }
    }
  }

  const totals = Object.values(byType).reduce(
    (acc, t) => ({ passed: acc.passed + (t?.passed ?? 0), failed: acc.failed + (t?.failed ?? 0) }),
    { passed: 0, failed: 0 }
  );

  return {
    attempted: pending.length,
    passed: totals.passed,
    failed: totals.failed,
    skipped,
    byType,
    commits,
    errors,
  };
}
