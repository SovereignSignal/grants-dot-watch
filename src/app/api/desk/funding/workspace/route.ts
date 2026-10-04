import { checkAuth } from '../../lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function serve(request: Request) {
  // Authenticate before importing the source-acquisition and registry workspace.
  // The route entry itself stays synchronous to load in a production Next build.
  if (!(await checkAuth(request)).ok) return Response.json({ error: 'unauthorized' }, {
    status: 401, headers: { 'Cache-Control': 'no-store' },
  });
  try {
    const { serveAuthenticatedFundingWorkspace } = await import('@/lib/funding-workspace-runtime');
    return await serveAuthenticatedFundingWorkspace(request);
  } catch {
    return Response.json({ error: 'workspace_unavailable' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function GET(request: Request) { return serve(request); }
export async function POST(request: Request) { return serve(request); }
