export const dynamic = 'force-dynamic';

/** Public repository revision only, used to confirm durable Desk delivery. */
export async function GET() {
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA;
  return Response.json({ commit: commit && /^[a-f0-9]{40}$/.test(commit) ? commit : null },
    { headers: { 'Cache-Control': 'no-store' } });
}
