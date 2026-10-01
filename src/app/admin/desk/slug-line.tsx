import type { QueueProposal } from './desk-types';
import { TYPE_SLUG_LABEL, wireVoiceLabel } from './desk-voice';

/** The wire dateline that opens every item: a wire-color marker square, the
 *  proposal type in the register's own words, the wire it came off, and any
 *  source-supplied numeric score. The score is context, not calibrated trust. */
export function SlugLine({ proposal, proposer }: { proposal: QueueProposal; proposer?: string }) {
  const { wire, confidence, type } = proposal;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span
        aria-hidden
        className="size-1.5 shrink-0"
        style={{ background: wire ? `var(--color-${wire})` : 'var(--color-line)' }}
      />
      <span className="coord">
        {TYPE_SLUG_LABEL[type]}
        {wire ? ` · ${wireVoiceLabel(wire)}` : ''}
        {proposer ? ` · ${proposer}` : ''}
        {confidence != null ? (
          <>
            {' · Source score '}
            <span className="text-dim">{confidence}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}
