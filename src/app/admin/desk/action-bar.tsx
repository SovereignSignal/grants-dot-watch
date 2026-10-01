'use client';

/** Sticky phone actions for the focused judgment. Reject opens a sheet on
 *  the page; this bar only starts that, or approves and skips. */
export function JudgmentBar({
  disabled,
  atStart,
  atEnd,
  onPrev,
  onNext,
  onApprove,
  onReject,
  onSkip,
}: {
  disabled?: boolean;
  atStart: boolean;
  atEnd: boolean;
  onPrev: () => void;
  onNext: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSkip: () => void;
}) {
  const move =
    'inline-flex min-h-12 flex-1 items-center justify-center border border-paper bg-void px-3 font-sans text-[13px] font-bold tracking-[.1em] text-paper uppercase disabled:opacity-40';
  const action =
    'inline-flex min-h-12 flex-1 items-center justify-center px-2 font-sans text-[12px] font-bold tracking-[.1em] uppercase disabled:opacity-40';

  return (
    <div
      data-testid="judgment-bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-paper bg-void px-3 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2">
        <div className="flex gap-2">
          <button type="button" className={move} onClick={onPrev} disabled={disabled || atStart} data-testid="desk-prev">
            Prev
          </button>
          <button type="button" className={move} onClick={onNext} disabled={disabled || atEnd} data-testid="desk-next">
            Next
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={`${action} bg-paper text-void`}
            onClick={onApprove}
            disabled={disabled}
            data-testid="desk-approve"
          >
            Approve
          </button>
          <button
            type="button"
            className={`${action} border border-paper bg-void text-paper`}
            onClick={onReject}
            disabled={disabled}
            data-testid="desk-reject"
          >
            Reject
          </button>
          <button
            type="button"
            className={`${action} border border-line bg-void text-dim`}
            onClick={onSkip}
            disabled={disabled || atEnd}
            data-testid="desk-skip"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
