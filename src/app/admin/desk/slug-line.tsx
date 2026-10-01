import type { QueueProposal } from './desk-types';
import { TYPE_SLUG_LABEL, wireVoiceLabel } from './desk-voice';

/** Type, wire, proposer, and score as small chips instead of one wrapping line. */
export function SlugLine({ proposal, proposer }: { proposal: QueueProposal; proposer?: string }) {
  const { wire, confidence, type } = proposal;
  const chips = [
    TYPE_SLUG_LABEL[type],
    wire ? wireVoiceLabel(wire) : null,
    proposer || null,
    confidence != null ? `Score ${confidence}` : null,
  ].filter((chip): chip is string => Boolean(chip));

  return (
    <div className="flex flex-wrap gap-1.5">
      {wire && (
        <span
          aria-hidden
          className="mt-1 size-1.5 shrink-0"
          style={{ background: `var(--color-${wire})` }}
        />
      )}
      {chips.map((chip) => (
        <span
          key={chip}
          className="border border-line px-1.5 py-0.5 font-sans text-[10px] font-semibold tracking-[.06em] text-dim uppercase"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}
