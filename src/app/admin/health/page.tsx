// The instrument panel: registry counts, load state, awards-by-year, and
// the curation desk queue depth. Server component. reads loadRegistry()
// directly and the desk store.
import Link from 'next/link';
import { briefingBoard, isOrgHomepageApply, liveCounts } from '@/lib/public-api';
import { daysUntil } from '@/components/programs/date-helpers';
import { loadRegistry } from '@/lib/registry';
import { getAppliedChangeLedgerHealth, getIngestState, listProposals, storeBackend } from '@/lib/desk-store';
import { lastBootReplayReport, type BootReplayReport } from '@/lib/boot-replay';
import { REVIEW_HORIZON_DAYS, reviewFreshness } from '@/lib/program-review';
import { wireProgramAutoApplyLine } from '@/lib/wire-program-auto-apply';
import { Card, Coord, Empty, PageHeader, Stat } from '@/components/ui';

export const metadata = { title: 'Health' };

// Reads the desk store (Postgres in prod). must never prerender at build time,
// where the DB's private network is unreachable.
export const dynamic = 'force-dynamic';

interface DeskSummary {
  pending: number;
  applying: number;
  decided: number;
}

/** Shape written by src/lib/ingest.ts's runIngest() / the daily timer —
 *  read loosely (everything optional) since ingest_state is a jsonb blob,
 *  not a typed table; a malformed or half-written record should degrade to
 *  "no data" fields, never crash the page. */
interface LastIngestRun {
  at?: string;
  skipped_lock?: boolean;
  error?: string;
  source_counts?: {
    wire?: { fetched?: number; error?: string | null };
    discuss?: { fetched?: number; error?: string | null };
  };
  proposals_created?: number;
  dropped?: number;
  validation?: { passed?: number; failed?: number };
  errors?: string[];
  award_sources?: {
    error?: string;
    skipped?: string | null;
    sources_tried?: number;
    sources_failed?: number;
    packets_queued?: number;
    packets_repeated?: number;
    packets_held?: number;
    packets_deferred?: number;
    approval?: boolean;
    auto_applied?: number;
    auto_applied_retries?: number;
    auto_apply_deferred?: { source?: string; pack_id?: string; reasons?: string[] }[];
    left_for_owner?: { source?: string; pack_id?: string; proposal_id?: string | null; queued?: boolean; reasons?: string[] }[];
    sources?: { source?: string; status?: string; error?: string | null }[];
  };
  /** Read by wireProgramAutoApplyLine, which tolerates any shape. */
  wire_program_auto_apply?: unknown;
}

/** One line for the daily award-source sweep, or null when it did not run. */
function awardSourcesLine(a: LastIngestRun['award_sources']): { text: string; failed: boolean } | null {
  if (!a || typeof a !== 'object') return null;
  if (a.error) return { text: `Award sources: failed (${a.error})`, failed: true };
  if (a.skipped) return { text: `Award sources: skipped (${a.skipped})`, failed: false };
  const failures = (Array.isArray(a.sources) ? a.sources : [])
    .filter((s) => s?.status === 'failed')
    .map((s) => `${s.source ?? 'unknown'}: ${s.error ?? 'failed'}`);
  const left = Array.isArray(a.left_for_owner) ? a.left_for_owner : [];
  const leftDetail = left
    .slice(0, 8)
    .map((p) => `${p?.pack_id ?? p?.source ?? 'packet'}${p?.proposal_id ? ` (${p.proposal_id})` : ''}: ${(p?.reasons ?? []).slice(0, 3).join(', ') || 'not clean'}`);
  return {
    text:
      `Award sources: ${a.sources_tried ?? 0} tried, ${a.packets_queued ?? 0} queued, ${a.packets_repeated ?? 0} repeated, ` +
      `${a.packets_held ?? 0} held, ${a.packets_deferred ?? 0} deferred, ${a.sources_failed ?? 0} failed` +
      (failures.length ? ` (${failures.join('; ')})` : '') +
      `. Auto-apply ${a.approval ? 'on' : 'off'}: ${a.auto_applied ?? 0} auto-applied` +
      (a.auto_applied_retries ? ` (${a.auto_applied_retries} retried)` : '') +
      `, ${Array.isArray(a.auto_apply_deferred) ? a.auto_apply_deferred.length : 0} deferred to next run, ${left.length} left for owner` +
      (leftDetail.length ? ` (${leftDetail.join('; ')}${left.length > leftDetail.length ? '; …' : ''})` : ''),
    failed: failures.length > 0,
  };
}

/** ingest_state's 'last_run' row (Postgres in prod, .data/ingest-state.json
 *  locally). absent until the timer or a manual POST /api/ingest/run has
 *  fired at least once. Never throws: a missing/corrupt row reads as null. */
async function loadLastIngestRun(): Promise<LastIngestRun | null> {
  try {
    const v = await getIngestState('last_run');
    return v && typeof v === 'object' ? (v as LastIngestRun) : null;
  } catch {
    return null;
  }
}

/** Desk operational state (see desk-store.ts). a missing/corrupt local store
 *  or an empty Postgres queue reads as empty. Null when the store itself is
 *  unreachable (Postgres down, or the production fail-closed): the page that
 *  reports a misconfigured store must not be taken down by it, and an
 *  unreadable queue renders as "Not available", never as a zero that reads as "empty". */
async function loadDeskSummary(): Promise<DeskSummary | null> {
  try {
    const proposals = await listProposals();
    const pending = proposals.filter((p) => p.state === 'pending').length;
    const applying = proposals.filter((p) => p.state === 'applying').length;
    const decided = proposals.filter((p) => p.state === 'approved' || p.state === 'rejected').length;
    return { pending, applying, decided };
  } catch {
    return null;
  }
}

const BACKEND_NOTE: Record<ReturnType<typeof storeBackend>, string> = {
  postgres: '',
  local: '. approvals live only on this container and do not survive a restart.',
  unconfigured: '. DATABASE_URL is not set in production; the Desk is refusing every write until it is.',
};

function formatLoadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

/** The three states the counters alone do not name: a backlog past the
 *  per-boot limit and a spent budget both leave approvals off this disk, and
 *  a torn row is half-applied data. Each one has to read as a condition, not
 *  as a clean pass with an odd number next to it. */
/** How many lapsing programs the card names before it stops being one screen.
 *  Twelve is the whole reviewed set today; the cap is what keeps the card the
 *  same size as coverage grows. */
const REVIEW_ROWS = 12;

function replayFlags(replay: BootReplayReport): string[] {
  return [
    replay.truncated ? 'backlog over the per-boot row limit' : null,
    replay.timedOut ? 'boot budget spent' : null,
    replay.torn ? 'TORN: a registry write was left half-applied' : null,
  ].filter((f): f is string => f !== null);
}

export default async function HealthPage() {
  const registry = loadRegistry();
  const { counts, awards, loadedAt, programs } = registry;
  const live = liveCounts(registry);
  const board = briefingBoard({ registry });
  const orgWebsite = new Map(registry.orgs.map((org) => [org.id, org.website]));
  const applyNow = [...board.dated, ...board.standingOpen];
  const missingApply = applyNow.filter((row) => !row.apply_url);
  const homepageApply = applyNow.filter((row) =>
    isOrgHomepageApply(row.apply_url, orgWebsite.get(row.org))
  );
  const closingSoon = board.dated.filter((row) => {
    const days = daysUntil(row.round.closes);
    return days !== null && days >= 0 && days <= 14;
  });
  const freshness = reviewFreshness(programs);
  // Expired first, then due; each half already sorted by date, which is the
  // order an operator works them in.
  const lapsing = [...freshness.expired.map((r) => ({ ...r, expired: true })), ...freshness.due.map((r) => ({ ...r, expired: false }))];
  const identityBlocked = freshness.expired.filter((r) => !r.renewable).length;
  const backend = storeBackend();
  const replay = lastBootReplayReport();
  const [desk, ingest, ledger] = await Promise.all([
    loadDeskSummary(),
    loadLastIngestRun(),
    // Same reason as loadDeskSummary: an unreadable ledger reports as "Not available".
    getAppliedChangeLedgerHealth().catch(() => null),
  ]);

  const byYear = new Map<string, number>();
  for (const a of awards) {
    const year = a.date ? a.date.slice(0, 4) : 'Undated';
    byYear.set(year, (byYear.get(year) || 0) + 1);
  }
  const years = [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const maxYearCount = Math.max(1, ...years.map(([, n]) => n));

  return (
    <div>
      <PageHeader
        eyebrow="THE INSTRUMENT PANEL"
        title="Health"
        sub="Registry counts, current rounds, review dates and the curation desk."
      />
      <div className="mx-auto max-w-6xl px-4 pb-16 space-y-8">
        <Card>
          <Coord>Registry counts</Coord>
          <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-3 md:grid-cols-6">
            {[
              { label: 'Systems', value: counts.systems },
              { label: 'Orgs', value: counts.orgs },
              { label: 'Funders', value: counts.funders },
              { label: 'Programs', value: counts.programs },
              { label: 'Awards', value: counts.awards },
              { label: 'Grantees', value: counts.grantees },
            ].map((s) => (
              <div key={s.label} className="px-4 py-3.5 first:pl-0">
                <Stat label={s.label} value={s.value} />
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3 coord">Registry loaded {formatLoadedAt(loadedAt)}</div>
        </Card>

        {/* Internal research dates do not gate the public program facts. */}
        <Card>
          <Coord>Review freshness</Coord>
          <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-4">
            <div className="py-3.5 pr-4">
              <Stat label="Expired" value={freshness.expired.length} />
            </div>
            <div className="px-4 py-3.5">
              <Stat label={`Expiring ≤${REVIEW_HORIZON_DAYS}d`} value={freshness.due.length} />
            </div>
            <div className="px-4 py-3.5">
              <Stat label="Status drift" value={freshness.drifted.length} />
            </div>
            <div className="py-3.5 pl-4">
              <Stat label="Reviewed" value={`${freshness.reviewed} / ${counts.programs}`} />
            </div>
          </div>
          {lapsing.length === 0 ? (
            <div className="mt-3">
              <Empty>Every review on file is current.</Empty>
            </div>
          ) : (
            // The awards-by-year row idiom, with a wider label column: a full
            // YYYY-MM-DD does not fit the w-16 a year sits in.
            <div className="mt-4 divide-y divide-line border-t border-line overflow-x-auto">
              {lapsing.slice(0, REVIEW_ROWS).map((r) => (
                <div key={r.id} className="flex items-center gap-4 py-2 text-xs">
                  <span className={`w-24 shrink-0 font-mono text-[11px] font-semibold tracking-[.08em] ${r.expired ? 'text-closing' : 'text-faint'}`}>{r.review_after}</span>
                  <span className={`min-w-0 truncate ${r.expired ? 'text-closing' : 'text-dim'}`}>{r.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">{r.expired ? (r.renewable ? 'expired' : 'expired · identity') : 'expiring'}</span>
                </div>
              ))}
              {lapsing.length > REVIEW_ROWS && (
                <div className="flex items-center gap-4 py-2 text-xs">
                  <span className="w-24 shrink-0 font-mono text-[11px] text-faint">+{lapsing.length - REVIEW_ROWS}</span>
                  <span className="text-faint">more lapsing, oldest first.</span>
                </div>
              )}
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3 coord">
            Review dates organize research follow-ups. Public program facts and their noted dates remain visible when a review is overdue.
          </div>
          <div className="mt-1.5 coord text-faint">
            Renew one wire at a time: npm run research:recheck -- --wire crypto --due-days {REVIEW_HORIZON_DAYS} --renew-days 30. It re-fetches each official source and proposes the renewal to the Desk; it never writes registry/ and never stamps a date it did not earn.
          </div>
          {identityBlocked > 0 && (
            <div className="mt-1.5 coord text-faint">
              {identityBlocked} expired {identityBlocked === 1 ? 'record is' : 'records are'} beyond a recheck: an unresolved identity, a former or unconfirmed operator, or a program that is not active. A renewed date alone does not resolve those questions.
            </div>
          )}
          {freshness.drifted.length > 0 && (
            <div className="mt-1.5 coord text-closing">
              Reviewed status no longer matches the program: {freshness.drifted.map((r) => r.id).join(', ')}. That is a status correction, not a renewal.
            </div>
          )}
        </Card>

        <Card>
          <Coord>Live board</Coord>
          <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-3 md:grid-cols-6">
            {[
              { label: 'Live today', value: live.total },
              { label: 'Dated', value: live.dated },
              { label: 'Standing', value: live.standing },
              { label: 'Closing soon', value: closingSoon.length },
              { label: 'No apply link', value: missingApply.length },
              { label: 'Homepage apply', value: homepageApply.length },
            ].map((s) => (
              <div key={s.label} className="px-4 py-3.5 first:pl-0">
                <Stat label={s.label} value={s.value} />
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3 text-sm text-dim">
            Same board as{' '}
            <Link href="/brief" className="border-b border-line text-paper hover:border-paper">
              /brief
            </Link>{' '}
            and{' '}
            <Link href="/api/v1/open" className="border-b border-line text-paper hover:border-paper">
              GET /api/v1/open
            </Link>
            . No apply and homepage apply should stay at zero for anything you would send a client.
          </div>
          {(missingApply.length > 0 || homepageApply.length > 0) && (
            <ul className="mt-3 border-t border-line pt-3 text-sm">
              {[...missingApply, ...homepageApply].map((row) => (
                <li key={`${row.program_id}::${row.round.name}`} className="border-b border-line py-2">
                  <Link href={row.href} className="text-paper hover:text-signal">
                    {row.program_name}
                  </Link>
                  <span className="coord mt-0.5 block">
                    {row.apply_url ? `Homepage apply: ${row.apply_url}` : 'No apply link'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <Coord>Awards by year</Coord>
          {years.length === 0 ? (
            <div className="mt-3">
              <Empty>No awards on file.</Empty>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-line border-t border-line overflow-x-auto">
              {years.map(([year, n]) => {
                const barLen = Math.max(1, Math.round((n / maxYearCount) * 30));
                return (
                  <div key={year} className="flex items-center gap-4 py-2 text-xs">
                    <span className="w-16 shrink-0 font-mono text-[11px] font-semibold tracking-[.08em] text-faint">{year}</span>
                    <span className="shrink-0 font-mono text-signal" aria-hidden>
                      {'▪'.repeat(barLen)}
                    </span>
                    <span className="ml-auto font-mono tabular-nums text-dim">{n.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <Coord>The Desk</Coord>
          <div className="mt-4 grid max-w-md grid-cols-3 divide-x divide-line border-t border-line">
            <div className="py-3.5 pr-4">
              <Stat label="Pending" value={desk ? desk.pending : 'Not available'} />
            </div>
            <div className="px-4 py-3.5">
              <Stat label="Applying / hold" value={desk ? desk.applying : 'Not available'} />
            </div>
            <div className="py-3.5 pl-4">
              <Stat label="Decided" value={desk ? desk.decided : 'Not available'} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-4">
            <div className="py-3.5 pr-4">
              <Stat label="Ready to sync" value={ledger ? ledger.ready : 'Not available'} />
            </div>
            <div className="px-4 py-3.5">
              <Stat label="Reconciling" value={ledger ? ledger.prepared : 'Not available'} />
            </div>
            <div className="px-4 py-3.5">
              <Stat label="Sync conflicts" value={ledger ? ledger.conflicts : 'Not available'} />
            </div>
            <div className="py-3.5 pl-4">
              <Stat label="Oldest ready" value={ledger?.oldestReadyAt ? formatLoadedAt(ledger.oldestReadyAt) : 'Not available'} />
            </div>
          </div>
          <div className="mt-4 border-t border-line pt-3 coord">
            Desk store: {backend}
            {BACKEND_NOTE[backend]}
          </div>
          {/* This container's boot replay of the durable outbox onto its own
              ephemeral registry/ (src/lib/boot-replay.ts). A postgres backend
              with no replay line means this instance is running an image from
              before the replay existed. itself the alarm. */}
          <div className="mt-1.5 coord text-faint">
            {replay
              ? `Boot replay: ${replay.status} · ${replay.applied} applied, ${replay.alreadyApplied} already on disk, ` +
                `${replay.failed} refused, ${replay.deferred} deferred` +
                (replay.superseded > 0 ? `, ${replay.superseded} superseded` : '') +
                ` of ${replay.scanned} scanned · ` +
                replayFlags(replay).map((f) => `${f} · `).join('') +
                `${replay.durationMs}ms · instance ${replay.instance} · ${formatLoadedAt(replay.at)}`
              : 'Boot replay: has not run on this instance.'}
          </div>
          {replay && replay.errors.length > 0 && (
            <div className="mt-1.5 coord text-closing">{replay.errors.join('; ')}</div>
          )}
        </Card>

        <Card>
          <Coord>Ingest</Coord>
          {!ingest ? (
            <div className="mt-3">
              <Empty>No ingest run yet. The daily timer is off (INGEST_ENABLED unset) or hasn&apos;t fired.</Empty>
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-4">
                <div className="px-4 py-3.5 pl-0">
                  <Stat label="Proposals created" value={ingest.proposals_created ?? 'Not available'} />
                </div>
                <div className="px-4 py-3.5">
                  <Stat label="Dropped" value={ingest.dropped ?? 'Not available'} />
                </div>
                <div className="px-4 py-3.5">
                  <Stat label="Machine-passed" value={ingest.validation?.passed ?? 'Not available'} />
                </div>
                <div className="px-4 py-3.5">
                  <Stat label="Machine-failed" value={ingest.validation?.failed ?? 'Not available'} />
                </div>
              </div>
              <div className="mt-4 border-t border-line pt-3 coord">
                Last run {ingest.at ? formatLoadedAt(ingest.at) : 'unknown time'}
                {ingest.skipped_lock ? '. Skipped (another instance held the lock).' : ''}
              </div>
              {ingest.source_counts && (
                <div className="mt-1.5 coord text-faint">
                  Wire: {ingest.source_counts.wire?.fetched ?? 0} fetched
                  {ingest.source_counts.wire?.error ? ` (error: ${ingest.source_counts.wire.error})` : ''}
                  {' · '}
                  Discuss.watch: {ingest.source_counts.discuss?.fetched ?? 0} fetched
                  {ingest.source_counts.discuss?.error ? ` (error: ${ingest.source_counts.discuss.error})` : ''}
                </div>
              )}
              {(() => {
                const line = awardSourcesLine(ingest.award_sources);
                return line ? <div className={`mt-1.5 coord ${line.failed ? 'text-closing' : 'text-faint'}`}>{line.text}</div> : null;
              })()}
              {(() => {
                const line = wireProgramAutoApplyLine(ingest.wire_program_auto_apply);
                return line ? <div className={`mt-1.5 coord ${line.failed ? 'text-closing' : 'text-faint'}`}>{line.text}</div> : null;
              })()}
              {(ingest.error || (ingest.errors && ingest.errors.length > 0)) && (
                <div className="mt-1.5 coord text-closing">
                  {ingest.error || ingest.errors!.join('; ')}
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
