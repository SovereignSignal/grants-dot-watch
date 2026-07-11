import { runValidation } from '@/lib/validation-runner';
import { checkAuth, unauthorized } from '../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ValidateBody {
  limit?: number;
}

/** Runs the deterministic machine-validation pipeline over pending proposals
 *  (both lanes) and applies/commits everything that passes. This is the
 *  graduation clause of docs/DESIGN.md's two-lane law: the Desk stops being
 *  a hand-approval queue for routine items and becomes an exception queue —
 *  what's left after this call is either a genuine judgment (new org,
 *  merge, editorial prose) or a check that failed with a reason attached. */
export async function POST(req: Request) {
  const auth = await checkAuth(req);
  if (!auth.ok) return unauthorized();

  let body: ValidateBody = {};
  try {
    body = await req.json();
  } catch {
    // no body / empty body is fine — the runner falls back to its own default limit
  }

  const limit = typeof body.limit === 'number' && body.limit > 0 ? body.limit : undefined;

  try {
    const result = await runValidation({ limit });
    return Response.json({
      passed: result.passed,
      failed: result.failed,
      skipped: result.skipped,
      byType: result.byType,
      commits: result.commits,
      errors: result.errors,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'validation run failed' }, { status: 500 });
  }
}
