import { PROGRAM_STATUS_LABEL, PROGRAM_STATUS_TONE } from './labels';

/** The operating status recorded for this program. */
export function ProgramStatusBadge({ status }: { status: string }) {
  const label = PROGRAM_STATUS_LABEL[status] || status;
  const dot = PROGRAM_STATUS_TONE[status] || PROGRAM_STATUS_TONE.unknown;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-dim">
      <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: dot }} />
      {label}
    </span>
  );
}
