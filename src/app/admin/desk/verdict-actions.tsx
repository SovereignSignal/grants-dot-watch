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
  variant = 'text',
}: {
  onApprove: () => void;
  onReject?: () => void;
  approveLabel: string;
  rejectLabel?: string;
  disabled?: boolean;
  /** `buttons` is the large tap target on a queue card and the bulk bar. */
  variant?: 'text' | 'buttons';
}) {
  if (variant === 'buttons') {
    return (
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled}
          className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center bg-paper px-5 font-sans text-[13px] font-bold tracking-[.12em] text-void uppercase disabled:cursor-default disabled:opacity-50 sm:w-auto sm:min-w-[11rem]"
        >
          {approveLabel}
        </button>
        {onReject && rejectLabel && (
          <button
            type="button"
            onClick={onReject}
            disabled={disabled}
            className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center border border-paper bg-transparent px-5 font-sans text-[13px] font-bold tracking-[.12em] text-paper uppercase disabled:cursor-default disabled:opacity-50 sm:w-auto sm:min-w-[11rem]"
          >
            {rejectLabel}
          </button>
        )}
      </div>
    );
  }

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
