// Official apply links for programs the Desk ledger publishes without one.
//
// Rows 806–811 (run 39335899819) replay byte-for-byte onto these paths. The
// sync login can read the ledger and stamp sha/synced_at, and it cannot edit
// `files`, so the committed ledger blob has to stay equal to content_after.
// The apply URL is added in a later commit. Boot replay treats that one
// inserted line as satisfying the ledger snapshot; any other difference is
// still a conflict.

export const APPLY_URL_BY_PATH = {
  'registry/programs/nsf-state-and-regional-ai-infrastructure-hubs-nsf-26-513.yaml':
    'https://www.nsf.gov/funding/opportunities/us-national-science-foundation-state-regional-artificial',
  'registry/programs/nsf-dcl-unleashing-a-new-age-of-ai-enabled-scientific-discov.yaml':
    'https://www.nsf.gov/funding/opportunities/dcl-unleashing-new-age-ai-enabled-scientific-discovery-through',
};

function applyLine(url) {
  return `apply_url: ${url}\n`;
}

/** Inserts the official apply URL on its own line immediately before `summary`.
 *  An existing apply_url is left untouched. */
export function withApplyUrl(content, url) {
  if (typeof content !== 'string') throw new Error('program snapshot is not text');
  const line = applyLine(url);
  if (content.includes(line)) return { content, changed: false };
  if (/^apply_url:/m.test(content)) return { content, changed: false };
  if (!/^summary:/m.test(content)) throw new Error('program snapshot has no summary line to anchor apply_url');
  return { content: content.replace(/^summary:/m, `${line}summary:`), changed: true };
}

/** Removes only the blessed apply line directly above `summary`. */
export function withoutBlessedApplyUrl(path, content) {
  const url = APPLY_URL_BY_PATH[path];
  if (!url || typeof content !== 'string') return content;
  const needle = `${applyLine(url)}summary:`;
  return content.includes(needle) ? content.replace(needle, 'summary:') : content;
}

/** True when `current` is the ledger snapshot, or that snapshot plus its blessed apply line. */
export function sameLedgerBytes(path, current, expected) {
  if (current === expected) return true;
  if (typeof current !== 'string' || typeof expected !== 'string') return false;
  return withoutBlessedApplyUrl(path, current) === expected;
}
