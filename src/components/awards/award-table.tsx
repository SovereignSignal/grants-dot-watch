import Link from 'next/link';
import { dateShort } from '@/lib/format';
import { awardAmountLabel } from '@/lib/awards';
import type { Award, Program } from '@/lib/types';

function gridColumns(showFunder: boolean, showProgram: boolean): string {
  if (showFunder && showProgram) {
    return 'sm:grid-cols-[minmax(0,1.2fr)_minmax(0,.9fr)_minmax(0,1fr)_110px_108px_68px]';
  }
  if (showProgram) return 'sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_120px_72px]';
  return 'sm:grid-cols-[minmax(0,1fr)_120px_120px_72px]';
}

export function AwardTable({
  awards,
  programs,
  orgIds,
  showFunder = false,
  showProgram,
}: {
  awards: Award[];
  programs: Program[];
  orgIds: Set<string>;
  showFunder?: boolean;
  showProgram: boolean;
}) {
  const programById = new Map(programs.map((program) => [program.id, program]));
  const columns = gridColumns(showFunder, showProgram);

  return (
    <>
      <div className={`hidden border-b border-line py-2 sm:grid sm:gap-x-5 ${columns}`}>
        <span className="coord">Recipient</span>
        {showFunder && <span className="coord">Funder</span>}
        {showProgram && <span className="coord">Program</span>}
        <span className="coord text-right">Amount</span>
        <span className="coord text-right">Date</span>
        <span className="coord text-right">Evidence</span>
      </div>

      <ol className="m-0 list-none p-0">
        {awards.map((award) => {
          const program = award.program ? programById.get(award.program) : null;
          const programLabel = program?.name || award.program_name;
          const recipient = orgIds.has(award.grantee) ? (
            <Link href={`/orgs/${award.grantee}`} className="display text-[15px] text-paper hover:text-signal">
              {award.grantee_name}
            </Link>
          ) : (
            <span className="display text-[15px] text-paper">{award.grantee_name}</span>
          );

          return (
            <li key={award.key} className={`grid gap-x-5 gap-y-1 border-b border-line py-3 sm:items-baseline ${columns}`}>
              <div className="min-w-0 break-words">{recipient}</div>
              {showFunder && (
                <div className="min-w-0 text-[12px] leading-snug text-dim break-words">
                  <span className="coord mr-2 sm:hidden">Funder</span>
                  {orgIds.has(award.funder) ? (
                    <Link href={`/orgs/${award.funder}`} className="hover:text-paper">
                      {award.funder_name}
                    </Link>
                  ) : (
                    award.funder_name
                  )}
                </div>
              )}
              {showProgram && (
                <div className="min-w-0 text-[12px] leading-snug text-dim break-words">
                  <span className="coord mr-2 sm:hidden">Program</span>
                  {program ? (
                    <Link href={`/programs/${program.id}`} className="hover:text-paper">
                      {program.name}
                    </Link>
                  ) : (
                    programLabel || <span className="text-faint">Unspecified</span>
                  )}
                </div>
              )}
              <div className="text-[12px] tabular-nums text-dim sm:text-right">
                <span className="coord mr-2 sm:hidden">Amount</span>
                {awardAmountLabel(award)}
              </div>
              <div className="text-[12px] tabular-nums text-faint sm:text-right">
                <span className="coord mr-2 sm:hidden">Date</span>
                {dateShort(award.date)}
              </div>
              <div className="text-[12px] sm:text-right">
                {award.source ? (
                  <a
                    href={award.source}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Source for ${award.grantee_name} award`}
                    className="text-dim hover:text-paper"
                  >
                    Source ↗
                  </a>
                ) : (
                  <span className="text-faint">–</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
