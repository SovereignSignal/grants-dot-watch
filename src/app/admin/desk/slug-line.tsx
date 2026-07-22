import type { QueueProposal } from './desk-types';
import { TYPE_SLUG_LABEL, wireVoiceLabel } from './desk-voice';

/** The wire dateline that opens every item: a wire-color marker square, the
 *  proposal type in the register's own words, the wire it came off, and any
 *  source-supplied numeric score. The score is context, not calibrated trust. */
export function SlugLine({ proposal }: { proposal: QueueProposal }) {
  const { wire, confidence, type } = proposal;
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="size-1.5 shrink-0"
        style={{ background: wire ? `var(--color-${wire})` : 'var(--color-line)' }}
      />
      <span className="coord">
        {TYPE_SLUG_LABEL[type]}
        {wire ? ` · ${wireVoiceLabel(wire)}` : ''}
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
