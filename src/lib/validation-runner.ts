// The Desk's machine-validation pipeline (docs/DESIGN.md two-lane law,
// graduation clause): runs proposal-validator.ts's deterministic checks
// against every pending proposal, applies + commits the ones that PASS
// exactly the way a human Approve would, and persists a failure record onto
// everything else so it stays pending — the Desk becomes an exception queue.
// No LLM calls anywhere in this file.
import { type AppliedChange, commitChange, writeProposalChanges } from './committer';
import { listProposals, recordVerdict, setProposalValidation } from './desk-store';
import { invalidateRegistryCache } from './registry';
import type { Proposal, ProposalType, ProposalValidation } from './types';
import { validateProposal } from './proposal-validator';

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
 *  every write goes through the same applyProposal-equivalent path
 *  (writeProposalChanges + commitChange + recordVerdict) The Desk's manual
 *  approve uses, so undo is the same `git revert` story. */
export async function runValidation(opts: RunValidationOptions = {}): Promise<RunValidationResult> {
  const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : DEFAULT_LIMIT;
  const pending = (await listProposals({ state: 'pending' })).slice(0, limit);

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

    for (const item of chunk) {
      try {
        const { changes } = writeProposalChanges(item.proposal);
        allChanges.push(...changes);
        applied.push(item);
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
        try {
          await setProposalValidation(item.proposal.id, validation);
        } catch {
          /* best effort — the item just stays pending with no validation note */
        }
        bump(byType, item.proposal.type, 'failed');
        errors.push({ id: item.proposal.id, error: `apply failed after passing validation: ${detail}` });
      }
    }

    if (allChanges.length === 0) continue;
    invalidateRegistryCache();

    const uniquePaths = [...new Set(allChanges.map((c) => c.path))];
    const commit = await commitChange(
      uniquePaths,
      machineCommitMessage(applied.map((a) => a.proposal)),
      applied.map((a) => a.proposal.id).join(',')
    );
    if (commit) commits.push(commit);

    for (const item of applied) {
      try {
        await recordVerdict(item.proposal.id, 'approved', {
          note: `machine-validated: ${passedChecksSummary(item.validation)}`,
          commit,
          by: 'machine',
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
