// Small formatting helpers local to The Desk (created_at/decided_at are full
// ISO timestamps, unlike the date-only strings src/lib/format.ts handles).
export function timeAgo(iso: string | undefined | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function shortUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.hostname}${path}`.slice(0, 60);
  } catch {
    return url.slice(0, 60);
  }
}

/** Absolute short date for evidence "seen" timestamps — timeAgo() is for
 *  recency at a glance, this is for "what date did I actually see this". */
export function dateShortIso(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Wire-service dateline for a citation line — "Jul 3", no year (the wire is
 *  read same-week; the year is the masthead's job, not every quote's). */
export function citeDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Collapses multi-line text to the first N lines, reporting whether there
 *  was more — the ~10-line collapsed-by-default rule for change previews. */
export function clampLines(text: string, maxLines: number): { visible: string; truncated: boolean; totalLines: number } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { visible: text, truncated: false, totalLines: lines.length };
  return { visible: lines.slice(0, maxLines).join('\n'), truncated: true, totalLines: lines.length };
}

export const GITHUB_REPO = 'SovereignSignal/grants-dot-watch';

export function commitUrl(sha: string): string {
  return `https://github.com/${GITHUB_REPO}/commit/${sha}`;
}
