import type { QueueProposal } from './desk-types';
import { citeDate } from './desk-format';

/** VALIDATE, at a glance: the wire signal a proposal claims to come from, set
 *  as an indented italic block quotation with a citation line — the register's
 *  own convention (canon: `.evidence .quote` + `.evidence .cite`). Joined
 *  server-side (see /api/desk/queue) so this never has to guess; when the
 *  join misses, that's shown honestly instead of hidden. */
export function EvidenceBlock({ proposal }: { proposal: QueueProposal }) {
  const { evidence } = proposal;
  const quote = evidence?.description || evidence?.title || null;

  return (
    <div className="mt-[18px] max-w-[740px] border-l border-line pl-5">
      {quote ? (
        <p className="serif-statement text-[15.5px] leading-[1.62] text-dim">&ldquo;{quote}&rdquo;</p>
      ) : (
        <p className="text-[13px] leading-relaxed text-faint">
          No wire signal on file{proposal.signal_id != null ? ` for signal ${proposal.signal_id}` : ''} — the proposal
          carries only: <span className="text-dim">&ldquo;{proposal.title}&rdquo;</span>
          {proposal.summary ? <span className="text-dim"> — {proposal.summary}</span> : null}.
        </p>
      )}
      <div className="mt-2 text-[11.5px] tracking-[.02em] text-faint">
        {evidence ? (
          <>
            — wire signal, {citeDate(evidence.seen_at)}
            {evidence.quality_score != null ? ` · quality ${evidence.quality_score}` : ''}
          </>
        ) : (
          '— no source on file'
        )}
        {proposal.evidence_url && (
          <>
            {' · '}
            <a
              href={proposal.evidence_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-line underline-offset-2 hover:text-dim"
            >
              verify at source ↗
            </a>
          </>
        )}
      </div>
    </div>
  );
}
