import { checkAuth, unauthorized } from '../../desk/lib';
import { ingestResearch, recentResearch, ResearchInputError } from '@/lib/research-intake';
import { withIngestLock } from '@/lib/desk-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!(await checkAuth(req)).ok) return unauthorized();
  try { return Response.json({ runs: await recentResearch() }); }
  catch { return Response.json({ error: 'Research history is temporarily unavailable' }, { status: 503 }); }
}
export async function POST(req: Request) {
  if (!(await checkAuth(req)).ok) return unauthorized();
  try {
    const reader = req.body?.getReader();
    if (!reader) return Response.json({ error: 'A JSON packet is required' }, { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 1_000_000) { await reader.cancel(); return Response.json({ error: 'Packet exceeds 1 MB' }, { status: 413 }); } chunks.push(next.value); }
    const packet = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const save = new URL(req.url).searchParams.get('save') === '1';
    const result = await withIngestLock(() => ingestResearch(packet, save));
    if (!result.ran) return Response.json({ error: 'Another intake is running. Retry shortly.' }, { status: 409 });
    return Response.json(result.result);
  } catch (error) {
    if (error instanceof ResearchInputError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ error: 'Invalid JSON packet' }, { status: 400 });
    return Response.json({ error: 'Research intake is temporarily unavailable. Retry the same packet.' }, { status: 503 });
  }
}
