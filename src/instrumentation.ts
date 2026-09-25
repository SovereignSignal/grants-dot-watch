// Next.js instrumentation hook — runs once per server instance boot. Two
// jobs: replay the durable applied-changes outbox onto this container's
// registry/ (Railway's filesystem is ephemeral, so an approved change written
// by a previous container is missing from this one — src/lib/boot-replay.ts),
// then, if INGEST_ENABLED=1, start the daily ingest loop's in-process
// 24h±jitter timer (src/lib/ingest.ts). Guarded to the nodejs runtime (the
// edge runtime also calls register(), but neither job belongs there: both
// need `pg` and node:fs, and the timer needs a long-lived setTimeout).
// Multi-instance safety differs per job and lives inside each: withIngestLock
// makes ingest run once across all replicas; the replay must run once PER
// replica, because each replica has its own ephemeral disk.
export async function register() {
  // Keep the imports inside the runtime branch so the development edge
  // compiler can exclude Node-only database and filesystem dependencies.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Awaited, and above the INGEST_ENABLED gate so it runs in every
    // deployment. Next serves no request until register() resolves, and that
    // is the only reason the replayed bytes become visible: registry.ts is a
    // different module instance in the page bundles than it is here, so
    // invalidating its cache from this side would do nothing. Move this off
    // the boot path and that stops being true.
    const { replayAppliedChanges } = await import('./lib/boot-replay');
    await replayAppliedChanges();
    if (process.env.INGEST_ENABLED !== '1') return;
    const { startDailyIngestTimer } = await import('./lib/ingest');
    startDailyIngestTimer();
  }
}
