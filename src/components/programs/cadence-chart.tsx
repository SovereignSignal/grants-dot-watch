import Link from 'next/link';
import { Empty } from '@/components/ui';
import { WIRE_COLOR } from '@/lib/format';
import type { Org, Program, System } from '@/lib/types';
import { isPast, monthDayShort, monthTickPercent, todayISO, yearPercent } from './date-helpers';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LABEL_W = 220; // px — the lane label column, shared by the month header, gridline overlay, and every row

/** Caption placement for a mark/bar-end at `pct` along the lane: anchors
 *  right-of-mark normally, but flips to read leftward past ~80% so a caption
 *  near December (or a late "today") never runs off the lane's right edge. */
function captionStyle(pct: number, gap = 10): React.CSSProperties {
  return pct > 80
    ? { right: `calc(${100 - pct}% + ${gap}px)`, textAlign: 'right' }
    : { left: `calc(${pct}% + ${gap}px)`, textAlign: 'left' };
}

type Plot =
  | { kind: 'mark'; pct: number; faded: boolean; caption: string }
  | { kind: 'bar'; startPct: number; endPct: number; faded: boolean; caption: string };

/** Positions a program's rounds against a Jan 1–Dec 31 axis for `year`. A
 *  round with distinct opens+closes both falling in-year becomes a window
 *  bar; a round with just one dated end becomes a diamond mark. Rounds with
 *  no date, or whose date falls outside `year`, contribute nothing — the
 *  caller reads an empty result as "plot the rolling band instead." */
function plotRounds(program: Program, year: number, todayStr: string): Plot[] {
  const out: Plot[] = [];
  for (const r of program.rounds || []) {
    const opensPct = yearPercent(r.opens, year);
    const closesPct = yearPercent(r.closes, year);
    if (opensPct !== null && closesPct !== null && r.opens !== r.closes) {
      out.push({
        kind: 'bar',
        startPct: Math.min(opensPct, closesPct),
        endPct: Math.max(opensPct, closesPct),
        faded: isPast(r.closes as string, todayStr),
        caption: `${monthDayShort(r.opens as string)}–${monthDayShort(r.closes as string)} round`,
      });
      continue;
    }
    // Prefer the closes date when it's the one that actually falls in-year —
    // a round whose closes lands outside `year` but whose opens lands inside
    // it should plot (and caption) against opens, not silently mislabel an
    // opens-derived position as a "closes" one.
    const usingCloses = closesPct !== null;
    const dateStr = usingCloses ? r.closes : opensPct !== null ? r.opens : undefined;
    const pct = usingCloses ? closesPct : opensPct;
    if (dateStr && pct !== null) {
      const faded = isPast(dateStr, todayStr);
      const verb = usingCloses ? (faded ? 'Closed' : 'Closes') : faded ? 'Opened' : 'Opens';
      out.push({ kind: 'mark', pct, faded, caption: `${verb} ${monthDayShort(dateStr)}` });
    }
  }
  return out;
}

/** Tab 2: the year-at-a-glance chart. Programs grouped under small-caps
 *  system headings, each a 12-month lane; rounds plotted as marks in wire
 *  hue, faded once past. `programs`/`orgs`/`systems` are the page's already
 *  filtered registry slices — pure server-rendered HTML/CSS grid, no chart
 *  library. */
export function CadenceChart({ programs, orgs, systems }: { programs: Program[]; orgs: Org[]; systems: System[] }) {
  if (programs.length === 0) return <Empty>No programs on file for this filter.</Empty>;

  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const systemById = new Map(systems.map((s) => [s.id, s]));
  const now = new Date();
  const year = now.getUTCFullYear();
  const todayStr = todayISO();
  const todayPct = yearPercent(todayStr, year) ?? 0;

  const groupMap = new Map<string, Program[]>();
  for (const p of programs) {
    const sid = (p.systems || []).find((s) => systemById.has(s));
    const key = sid || '__other';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(p);
  }
  const groups = [...groupMap.entries()]
    .map(([key, progs]) => ({
      key,
      label: key === '__other' ? 'Other Programs' : systemById.get(key)!.name,
      programs: [...progs].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      if (a.key === '__other') return 1;
      if (b.key === '__other') return -1;
      return b.programs.length - a.programs.length || a.label.localeCompare(b.label);
    });

  return (
    <div className="pt-5">
      <div className="flex items-end border-b-[1.5px] border-paper pb-1">
        <div style={{ width: LABEL_W }} className="shrink-0" />
        <div className="relative h-6 flex-1">
          {MONTH_LABELS.map((m, i) => (
            <span key={m} className="coord absolute top-0 whitespace-nowrap text-faint" style={{ left: `${monthTickPercent(i, year)}%` }}>
              {m}
            </span>
          ))}
          <span
            className="absolute top-[14px] whitespace-nowrap text-[9.5px] font-extrabold uppercase tracking-[.06em] text-paper"
            style={captionStyle(todayPct, 4)}
          >
            ◆ Today — {monthDayShort(todayStr)}
          </span>
        </div>
      </div>

      <div className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 z-0" style={{ left: LABEL_W, right: 0 }}>
          {MONTH_LABELS.map((m, i) => (
            <span key={m} className="absolute inset-y-0 w-px bg-line" style={{ left: `${monthTickPercent(i, year)}%` }} />
          ))}
          <span className="absolute inset-y-0 w-px bg-line" style={{ left: '100%' }} />
          <span className="absolute inset-y-0 w-[1.5px] bg-paper opacity-70" style={{ left: `${todayPct}%` }} />
        </div>

        {groups.map((g) => (
          <div key={g.key} className="relative z-10">
            <div className="mt-6 mb-0.5 flex items-baseline gap-2.5 first:mt-2">
              <span className="whitespace-nowrap text-[12px] font-extrabold uppercase tracking-[.07em] text-paper">{g.label}</span>
              <span aria-hidden className="h-px flex-1 -translate-y-[3px] bg-line" />
              <span className="coord whitespace-nowrap">
                {g.programs.length} program{g.programs.length === 1 ? '' : 's'}
              </span>
            </div>

            {g.programs.map((p) => {
              const org = orgById.get(p.org);
              const wire = (p.wires || [])[0] || null;
              const wireColor = wire ? WIRE_COLOR[wire] : 'var(--color-faint)';
              const marks = plotRounds(p, year, todayStr);
              return (
                <div key={p.id} className="flex items-center border-b border-line py-1.5">
                  <Link href={`/programs/${p.id}`} className="shrink-0 pr-4 hover:opacity-70" style={{ width: LABEL_W }}>
                    <div className="display truncate text-[13.5px] leading-tight text-paper">{p.name}</div>
                    <div className="coord mt-0.5 truncate">{org?.name || p.org}</div>
                  </Link>
                  <div className="relative h-7 flex-1">
                    {marks.length === 0 ? (
                      <>
                        <span
                          aria-hidden
                          className="absolute top-1/2 right-0 left-0 -translate-y-1/2 border-t-[1.5px] border-dashed opacity-30"
                          style={{ borderColor: wireColor }}
                        />
                        <span className="coord absolute top-1/2 left-[44%] -translate-y-1/2 bg-void px-2 text-faint italic">
                          rolling — by engagement
                        </span>
                      </>
                    ) : (
                      marks.map((m, i) =>
                        m.kind === 'bar' ? (
                          <span key={i}>
                            <span
                              aria-hidden
                              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-[1px]"
                              style={{ left: `${m.startPct}%`, width: `${m.endPct - m.startPct}%`, background: wireColor, opacity: m.faded ? 0.35 : 0.75 }}
                            />
                            <span
                              className={`coord absolute top-1/2 -translate-y-1/2 whitespace-nowrap ${m.faded ? 'text-faint' : 'text-dim'}`}
                              style={captionStyle(m.endPct)}
                            >
                              {m.caption}
                            </span>
                          </span>
                        ) : (
                          <span key={i}>
                            <span
                              aria-hidden
                              className="absolute top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45"
                              style={{ left: `${m.pct}%`, background: wireColor, opacity: m.faded ? 0.45 : 1 }}
                            />
                            <span
                              className={`coord absolute top-1/2 -translate-y-1/2 whitespace-nowrap ${m.faded ? 'text-faint' : 'text-dim'}`}
                              style={captionStyle(m.pct)}
                            >
                              {m.caption}
                            </span>
                          </span>
                        ),
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t-[2.5px] border-paper pt-3">
        <span className="coord flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-[6px] rotate-45 bg-paper" />
          Round mark — full color is open or ahead of today, faded is past
        </span>
        <span className="coord flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-[6px] w-4 rounded-[1px] bg-paper opacity-70" />
          Application window
        </span>
        <span className="coord flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 border-t-[1.5px] border-dashed border-faint" />
          Rolling intake, by engagement
        </span>
      </div>
    </div>
  );
}
