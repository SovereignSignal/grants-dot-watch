import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { buildProposalChanges, type AppliedChange } from '@/lib/committer';
import { getProposal } from '@/lib/desk-store';
import { checkAuth, unauthorized } from '../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPO_ROOT = process.cwd();

export interface FieldDiff {
  field: string;
  before: string;
  after: string;
}

export interface PreviewChange {
  path: string;
  op: AppliedChange['op'];
  heading: string;
  content: string;
  diff?: FieldDiff[];
}

/** Plain-language heading for what a change does — the "WHAT" a card leads
 *  with, ahead of any YAML. Derived from the same repo-relative path
 *  buildProposalChanges returns, never a second guess at it. */
function headingFor(path: string, op: AppliedChange['op']): string {
  const kind = path.startsWith('registry/orgs/')
    ? 'organization'
    : path.startsWith('registry/programs/')
      ? 'program'
      : path.startsWith('registry/awards/')
        ? 'award'
        : path.startsWith('registry/systems/')
          ? 'system'
          : 'file';
  if (op === 'create') return `Creates a new ${kind} file`;
  if (op === 'append') return `Appends a new ${kind === 'award' ? 'award record' : 'record'}`;
  return `Updates the ${kind} file, changed fields only`;
}

function renderValue(v: unknown): string {
  if (v === undefined) return '(none)';
  if (v === null) return 'null';
  if (typeof v === 'string') return v || '(empty)';
  return YAML.stringify(v, { lineWidth: 100 }).trim();
}

/** Changed top-level fields only, old vs new — never a full-file diff. Reads
 *  the file as it stands on disk right now; buildProposalChanges is a pure
 *  dry run, so this is still the pre-change version even after computing
 *  what approve would write. */
function diffAgainstDisk(path: string, afterText: string): FieldDiff[] | undefined {
  const abs = join(REPO_ROOT, path);
  if (!existsSync(abs)) return undefined;
  let before: Record<string, unknown>;
  let after: Record<string, unknown>;
  try {
    before = (YAML.parse(readFileSync(abs, 'utf8')) || {}) as Record<string, unknown>;
    after = (YAML.parse(afterText) || {}) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: FieldDiff[] = [];
  for (const field of keys) {
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
    out.push({ field, before: renderValue(before[field]), after: renderValue(after[field]) });
  }
  return out;
}

export async function GET(req: Request) {
  const auth = await checkAuth(req);
  if (!auth.ok) return unauthorized();

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const proposal = await getProposal(id);
  if (!proposal) return Response.json({ error: 'not found' }, { status: 404 });

  try {
    const { changes, notes } = buildProposalChanges(proposal);
    const enriched: PreviewChange[] = changes.map((c) => ({
      path: c.path,
      op: c.op,
      heading: headingFor(c.path, c.op),
      content: c.content,
      diff: c.op === 'update' ? diffAgainstDisk(c.path, c.content) : undefined,
    }));
    return Response.json({ changes: enriched, notes });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'preview failed' }, { status: 500 });
  }
}
