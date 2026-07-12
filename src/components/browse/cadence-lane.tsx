// The 12-month program cadence micro-lane, stolen economically from
// design/mocks/c-orgcard.html's .cadence-head/.cadence-rows. A Jan–Dec ruler
// (day-of-year/365 positioning, matching the mock's own math) with a "today"
// marker; each program row plots its dated rounds as ticks, or — honestly,
// per the phase-2B brief — falls back to a plain-language caption when it has
// no rounds in the current window. No client JS: everything is inline-style
// percentages computed at render time.
import Link from 'next/link';
import type { Program, Round } from '@/lib/types';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Cumulative day-of-year at the 1st of each month (non-leap approximation —
// this is a visual ruler, not a calendar engine).
const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const LABEL_W = 184;

function pct(days: number): number {
  return (days / 365) * 100;
}

function dayOfYearPct(dateStr: string | undefined, year: number): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() !== year) return null;
  const start = Date.UTC(year, 0, 1);
  const days = Math.round((d.getTime() - start) / 86_400_000);
  return pct(days);
}

const ROUND_DOT: Record<string, string> = {
  open: 'var(--color-live)',
  announced: 'var(--color-signal)',
  reviewing: 'var(--color-closing)',
  closed: 'var(--color-faint)',
  deployed: 'var(--color-faint)',
};

export interface CadenceRow {
  program: Program;
  grantCount: number;
}

export function CadenceLane({ rows, year }: { rows: CadenceRow[]; year?: number }) {
  const y = year ?? new Date().getUTCFullYear();
  const todayPct = dayOfYearPct(new Date().toISOString().slice(0, 10), y);

  return (
    <div className="mt-1">
      {/* month ruler */}
      <div className="flex pt-3.5 pb-1">
        <div className="shrink-0" style={{ width: LABEL_W }} />
        <div className="relative h-5 flex-1">
          {MONTH_ABBR.map((m, i) => (
            <span
              key={m}
              className="coord absolute top-0 text-[9px] whitespace-nowrap"
              style={{ left: `${pct(CUM_DAYS[i])}%` }}
            >
              {m}
            </span>
          ))}
          {todayPct != null && (
            <span
              className="absolute top-3.5 text-[9px] font-bold whitespace-nowrap text-paper uppercase"
              style={{ left: `${todayPct}%` }}
            >
              ◆ Today
            </span>
          )}
        </div>
      </div>

      {/* rows + gridline overlay */}
      <div className="relative border-t border-line">
        <div className="pointer-events-none absolute inset-0" aria-hidden style={{ left: LABEL_W }}>
          {CUM_DAYS.map((d, i) => (
            <span key={i} className="absolute top-0 bottom-0 w-px bg-line" style={{ left: `${pct(d)}%` }} />
          ))}
          <span className="absolute top-0 bottom-0 w-px bg-line" style={{ left: '100%' }} />
          {todayPct != null && (
            <span className="absolute top-0 bottom-0 w-[1.5px] bg-paper opacity-40" style={{ left: `${todayPct}%` }} />
          )}
        </div>

        {rows.map(({ program, grantCount }) => {
          const dated = (program.rounds || [])
            .map((r) => ({ r, p: dayOfYearPct(r.closes || r.opens, y) }))
            .filter((x): x is { r: Round; p: number } => x.p != null);
          const hasAnyRounds = (program.rounds || []).length > 0;
          const caption = dated.length > 0 ? null : hasAnyRounds ? `No ${y} rounds on file` : 'Rolling, by engagement';

          return (
            <div key={program.id} className="relative z-10 flex items-center border-b border-line">
              <div className="shrink-0 py-2.5 pr-3" style={{ width: LABEL_W }}>
                <Link href={`/programs/${program.id}`} className="display block truncate text-[14px] leading-tight text-paper hover:text-signal">
                  {program.name}
                </Link>
                <div className="coord mt-0.5 text-[9.5px]">
                  {grantCount} grant{grantCount === 1 ? '' : 's'} tracked
                </div>
              </div>
              <div className="relative h-[28px] flex-1">
                {caption ? (
                  <>
                    <span aria-hidden className="absolute top-1/2 right-0 left-0 -translate-y-1/2 border-t border-dashed border-line opacity-70" />
                    <span className="coord absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-void px-2 text-[9px] whitespace-nowrap">
                      {caption}
                    </span>
                  </>
                ) : (
                  dated.map(({ r, p }, i) => (
                    <span
                      key={i}
                      title={`${r.name}: ${r.status}${r.closes ? `, closes ${r.closes}` : r.opens ? `, opens ${r.opens}` : ''}`}
                      className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${p}%`, background: ROUND_DOT[r.status] || 'var(--color-faint)' }}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
