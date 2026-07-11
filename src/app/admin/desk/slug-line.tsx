import type { QueueProposal } from './desk-types';
import { CONFIDENCE_GOLD_THRESHOLD, TYPE_SLUG_LABEL, wireVoiceLabel } from './desk-voice';

/** The wire dateline that opens every item: a wire-color marker square, the
 *  proposal type in the register's own words, the wire it came off, and the
 *  model's confidence — gold once it clears the threshold the register
 *  trusts on sight. Canon: "NEW ORGANIZATION · CRYPTO WIRE · CONFIDENCE 85". */
export function SlugLine({ proposal }: { proposal: QueueProposal }) {
  const { wire, confidence, type } = proposal;
  const gold = confidence != null && confidence >= CONFIDENCE_GOLD_THRESHOLD;
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
            {' · Confidence '}
            <span className={gold ? 'text-signal' : 'text-dim'}>{confidence}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}
