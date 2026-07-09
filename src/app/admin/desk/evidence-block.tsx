import type { QueueProposal } from './desk-types';
import { dateShortIso } from './desk-format';

/** VALIDATE, at a glance: the original wire signal a proposal claims to come
 *  from — title, the enriched/raw summary, quality score, and when it was
 *  seen — joined server-side (see /api/desk/queue) so this never has to
 *  guess. When the join misses, that's shown honestly instead of hidden. */
export function EvidenceBlock({ proposal }: { proposal: QueueProposal }) {
  const { evidence } = proposal;
  return (
    <div className="rounded-md border border-line bg-deep/60 p-3">
      <div className="coord mb-2 flex items-center justify-between gap-2">
        <span>Evidence</span>
        {proposal.confidence != null && <span className="font-mono normal-case text-paper">confidence {proposal.confidence}%</span>}
      </div>

      {evidence ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium leading-snug text-paper">{evidence.title}</p>
          {evidence.description && <p className="line-clamp-3 text-sm text-dim">{evidence.description}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
            <span className="font-mono">quality {evidence.quality_score ?? '—'}</span>
            <span className="coord">seen {dateShortIso(evidence.seen_at)}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-faint">
          No wire signal on file{proposal.signal_id != null ? ` for signal ${proposal.signal_id}` : ''} — showing what
          this proposal carries: <span className="text-dim">&ldquo;{proposal.title}&rdquo;</span>
          {proposal.summary ? <span className="text-dim"> — {proposal.summary}</span> : null}.
        </p>
      )}

      {proposal.evidence_url && (
        <a
          href={proposal.evidence_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-signal hover:underline"
        >
          Verify at source ↗
        </a>
      )}
    </div>
  );
}
