import Link from 'next/link';
import { awardAmountLabel } from '@/lib/awards';
import { dateShort, WIRE_LABEL } from '@/lib/format';
import type { Award } from '@/lib/types';

export function LatestAwards({
  awards,
  total,
  orgIds,
}: {
  awards: Award[];
  total: number;
  orgIds: Set<string>;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
        <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">Latest Awards</h2>
        <span className="coord shrink-0">
          {awards.length} of {total.toLocaleString()}
        </span>
      </div>
      {awards.length === 0 ? (
        <p className="serif-statement mt-4 text-sm text-dim">No awards on file yet.</p>
      ) : (
        <div className="flex flex-col">
          {awards.map((award) => {
            const wire = award.wire;
            return (
              <div key={award.key} className="flex items-start gap-2.5 border-b border-line py-3">
                <span
                  aria-hidden
                  className="mt-[6px] size-1.5 shrink-0"
                  style={{ background: wire ? `var(--color-${wire})` : 'var(--color-line)' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0 text-[13.5px] leading-snug text-paper">
                      {orgIds.has(award.funder) ? (
                        <Link href={`/orgs/${award.funder}`} className="hover:text-signal">
                          {award.funder_name}
                        </Link>
                      ) : (
                        <span>{award.funder_name}</span>
                      )}
                      <span className="text-faint"> → </span>
                      {orgIds.has(award.grantee) ? (
                        <Link href={`/orgs/${award.grantee}`} className="hover:text-signal">
                          {award.grantee_name}
                        </Link>
                      ) : (
                        <span>{award.grantee_name}</span>
                      )}
                    </div>
                    <div className="shrink-0 text-[12px] tabular-nums text-dim">{awardAmountLabel(award)}</div>
                  </div>
                  <div className="coord mt-0.5">
                    {dateShort(award.date)}
                    {wire ? ` · ${WIRE_LABEL[wire]}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 text-xs text-faint">
        <Link href="/awards" className="border-b border-line font-semibold text-dim hover:border-paper hover:text-paper">
          see all {total.toLocaleString()} awards →
        </Link>
      </div>
    </section>
  );
}
