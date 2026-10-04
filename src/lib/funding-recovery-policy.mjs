/** A failed replay with an empty local directory must not look like a valid
 * empty funding registry. No database access is performed by this guard. */
export function assertFundingRecoveryReady(report, requiresReplay) {
  if (!requiresReplay) return;
  if (!report || report.status !== 'ok' || report.torn || report.truncated || report.timedOut || report.failed > 0 || report.deferred > 0) {
    throw new Error('Durable funding recovery is incomplete');
  }
}
