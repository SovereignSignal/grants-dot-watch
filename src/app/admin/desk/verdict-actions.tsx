'use client';

/** Typographic verdicts — no colored buttons, ever (canon mock: "Approve —
 *  set in registry" (ink underline) / "Reject" (dim)). Purely presentational;
 *  callers compute the label text themselves so the same two controls serve
 *  a single proposal card, the sticky bulk bar, and the Facts "apply all"
 *  action, each with its own idle/busy copy. */
export function VerdictActions({
  onApprove,
  onReject,
  approveLabel,
  rejectLabel,
  disabled = false,
}: {
  onApprove: () => void;
  onReject?: () => void;
  approveLabel: string;
  rejectLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-1.5">
      <button
        type="button"
        onClick={onApprove}
        disabled={disabled}
        className="cursor-pointer text-[12.5px] font-bold tracking-[.02em] text-paper underline decoration-1 underline-offset-[3px] disabled:cursor-default disabled:opacity-50"
      >
        {approveLabel}
      </button>
      {onReject && rejectLabel && (
        <>
          <span className="text-[12px] text-line" aria-hidden>
            ·
          </span>
          <button
            type="button"
            onClick={onReject}
            disabled={disabled}
            className="cursor-pointer text-[12.5px] font-semibold text-faint hover:text-dim disabled:cursor-default disabled:opacity-50"
          >
            {rejectLabel}
          </button>
        </>
      )}
    </div>
  );
}
