// Next.js instrumentation hook — runs once per server instance boot. Its
// only job here is the daily ingest loop's scheduler: if INGEST_ENABLED=1,
// start the in-process 24h±jitter timer (src/lib/ingest.ts). Guarded to the
// nodejs runtime (the edge runtime also calls register(), but the ingest
// timer needs `pg` and long-lived setTimeout, neither of which belong
// there). Multi-instance safety (Railway runs several replicas of this same
// process) is the pg advisory lock inside withIngestLock, not anything here.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.INGEST_ENABLED !== '1') return;

  const { startDailyIngestTimer } = await import('./lib/ingest');
  startDailyIngestTimer();
}
