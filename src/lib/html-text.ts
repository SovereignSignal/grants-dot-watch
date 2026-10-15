// Linear-time HTML stripping shared by the page matchers (normalizeForMatch
// in proposal-validator.ts, normalizeMoneyText in money-match.ts). Fetched
// pages are up to 1 MB and attacker-shaped, and the regexes these replace
// went quadratic on many unclosed openers or stray "<", stalling the event
// loop. Both functions make one forward pass; every search starts where the
// previous one ended.

const HIDDEN = /<(script|style|noscript|template)\b/g;

/** ASCII-only lowercase: same length as the input, so indexes line up. */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

/**
 * Replaces each script, style, noscript or template block with
 * `replacement`. A block is the opening tag through the first `</name>`
 * after it, matched case-insensitively, which is what
 * /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi removed on a
 * well-formed page.
 *
 * An opener with no `>` or no closer drops the rest of the document. A
 * browser treats everything after an unclosed <script> as script, never as
 * visible text, so nothing after it can count as evidence on the page. (The
 * old regex left such an opener as a plain tag and matched the hidden text
 * after it.) Dropping can only refuse a match, never create one. The closer
 * is the exact `</name>`, as before; a page that closes only with
 * `</script >` drops the rest, which is again the refusing side.
 */
export function stripHiddenBlocks(html: string, replacement: string): string {
  const lower = asciiLower(html);
  const opener = new RegExp(HIDDEN.source, 'g');
  let out = '';
  let at = 0;
  for (;;) {
    opener.lastIndex = at;
    const m = opener.exec(lower);
    if (!m) return out + html.slice(at);
    out += html.slice(at, m.index) + replacement;
    const gt = lower.indexOf('>', m.index + m[0].length);
    if (gt < 0) return out;
    const close = lower.indexOf(`</${m[1]}>`, gt + 1);
    if (close < 0) return out;
    at = close + m[1].length + 3;
  }
}

/**
 * Replaces each tag with `replacement`: from a `<` to the next `>`, with at
 * least one character between them. The same result as
 * `.replace(/<[^>]+>/g, replacement)`, without its quadratic backtracking
 * when a page has many `<` and no `>`.
 */
export function stripTags(html: string, replacement: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const lt = html.indexOf('<', at);
    if (lt < 0) return out + html.slice(at);
    const gt = html.indexOf('>', lt + 1);
    if (gt < 0) return out + html.slice(at);
    // "<>" is not a tag: keep the "<" and look again from the ">".
    if (gt === lt + 1) {
      out += html.slice(at, lt + 1);
      at = lt + 1;
      continue;
    }
    // [^>]+ from the leftmost "<" runs to the first ">".
    out += html.slice(at, lt) + replacement;
    at = gt + 1;
  }
}
