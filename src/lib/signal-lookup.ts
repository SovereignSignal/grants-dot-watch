// Server-only, read-only: joins a Desk proposal back to the wire signal it
// came from, so an approver can validate a claim against its source. Reads
// the static seed/recent_signals.json snapshot — never writes it, never
// mutates it. If the snapshot is missing or a signal_id doesn't resolve,
// callers get null and show the proposal's own carried fields instead
// (see docs/DESIGN.md: "Files are the truth" — this module has no write door).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const SIGNALS_PATH = join(REPO_ROOT, 'seed', 'recent_signals.json');

export interface SignalEvidence {
  id: number | string;
  title: string;
  description: string | null;
  quality_score: number | null;
  source_url: string | null;
  seen_at: string | null; // source_published_at, falling back to created_at
  wire: string | null;
  status: string | null;
}

interface RawSignal {
  id: number | string;
  name?: string | null;
  description?: string | null;
  enriched_summary?: string | null;
  source_url?: string | null;
  quality_score?: number | null;
  wire?: string | null;
  status?: string | null;
  created_at?: string | null;
  source_published_at?: string | null;
}

let _index: Map<string, SignalEvidence> | null = null;

function buildIndex(): Map<string, SignalEvidence> {
  const idx = new Map<string, SignalEvidence>();
  if (!existsSync(SIGNALS_PATH)) return idx;
  try {
    const raw = JSON.parse(readFileSync(SIGNALS_PATH, 'utf8'));
    if (!Array.isArray(raw)) return idx;
    for (const s of raw as RawSignal[]) {
      if (!s || s.id == null) continue;
      idx.set(String(s.id), {
        id: s.id,
        title: s.name || 'Untitled signal',
        // enriched_summary is the newsletter-ready text when present; description is the raw wire text.
        description: s.enriched_summary || s.description || null,
        quality_score: typeof s.quality_score === 'number' ? s.quality_score : null,
        source_url: s.source_url || null,
        seen_at: s.source_published_at || s.created_at || null,
        wire: s.wire || null,
        status: s.status || null,
      });
    }
  } catch {
    // a broken/missing snapshot never takes the Desk down — evidence just reads as missing
  }
  return idx;
}

/** Lazy singleton: the seed snapshot is static for the life of the process. */
function index(): Map<string, SignalEvidence> {
  if (!_index) _index = buildIndex();
  return _index;
}

/** Looks up the wire signal a proposal's signal_id points at. Returns null
 *  when there's no signal_id, or the id isn't in the snapshot — callers must
 *  handle that honestly (show what the proposal itself carries) rather than
 *  hide the gap. */
export function getSignalEvidence(signalId: number | string | null | undefined): SignalEvidence | null {
  if (signalId == null) return null;
  return index().get(String(signalId)) || null;
}
