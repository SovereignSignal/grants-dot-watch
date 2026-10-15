// Amount matching for the Wire program auto-apply. A Wire amount (a round
// `size`) may publish without the owner only when the same amount, in the
// same currency, is written on the fetched page. Both sides go through one
// normalization (normalizeMoneyText) and one grammar, so "$75,000", "$75k",
// "75,000 USD" and "USD 75,000" are one value, and a number is always read
// whole: 175,000 is never 75,000.
//
// The grammar is narrow on purpose. Anything it cannot read with certainty
// (no currency, extra words, a lone multiplier in a range, "1.500M", a number
// that runs on into more digits) is no amount at all: on the proposal side
// that leaves the item for the owner, and on the page side that mention
// simply does not count.
//
// Everything here is linear in the input and bounded: pages are read up to
// MAX_SCAN_CHARS of normalized text and MAX_ATOMS numbers, look-backs use a
// fixed window, and no regex can backtrack across the page.

import { stripHiddenBlocks, stripTags } from './html-text';

export interface MoneyExpr {
  currency: string;
  /** Amounts in hundredths, so 1.5M and 1,500,000 compare equal. */
  min: number;
  max: number;
  range: boolean;
  upTo: boolean;
  /** The text as written, "up to" included. */
  text: string;
  start: number;
  end: number;
}

export interface MoneyScan {
  exprs: MoneyExpr[];
  /** True when the text or the number count passed its cap: only the first
   *  part was read, and an amount past it counts as not found. */
  truncated: boolean;
}

/** Normalized page text read for amounts. */
export const MAX_SCAN_CHARS = 300_000;
/** Numbers read per page. */
export const MAX_ATOMS = 5_000;
/** How far back "up to", "between" or a currency prefix letter is looked for. */
const LOOKBACK = 24;

/** Where a tag stood. Not whitespace and not a digit separator, so a number
 *  split by markup ("$75,<b>000</b>") never reads as one number. */
const TAG = '\ue000';
/** The one thin space kept as a thousands separator (U+2009 and U+202F both
 *  become U+202F). A plain or no-break space never separates thousands. */
const THIN = '\u202f';

const SYMBOLS: Record<string, string> = { $: 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP' };
const CODES = ['USDC', 'USDT', 'USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'DAI'];
const MULTIPLIERS: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mn: 1e6, mio: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9,
};
const CODE = CODES.join('|');
const SEP = `[,.'’${THIN}]`;
/** A gap of one space or tag (normalization collapses runs to one). */
const GAP = `[ ${TAG}]`;
/** A number may not touch more digits through a separator, space or tag:
 *  "75 000", "75, 000" and "75<b>000</b>" are unreadable, never 75. */
const NUM_START = String.raw`(?<!\d${SEP}?${GAP}?${SEP}?)(?<!${SEP})`;
const NUM_END = String.raw`(?!${SEP}?${GAP}?${SEP}?\d)`;
/** A grouped number (one separator, groups of three, optional decimals) or a plain one. */
const NUMBER = String.raw`\d{1,3}(?<sep>${SEP})\d{3}(?:\k<sep>\d{3})*(?:[.,]\d{1,2})?${NUM_END}|\d+(?:[.,]\d{1,2})?${NUM_END}`;
const ATOM = new RegExp(
  String.raw`(?:(?<sym>US\$|[$€£])${GAP}?|(?<pre>\b(?:${CODE}))${GAP}?)?` +
    `${NUM_START}(?<num>${NUMBER})` +
    // "75k", "1.5M", "2bn" are written tight; only a whole word may stand apart ("1 million").
    String.raw`(?:(?:(?<mult>[kK]|[mM]{1,2}|[mM]n|[bB][nN]?)|${GAP}?(?<multWord>[tT]housand|[mM]illion|[bB]illion|[mM]io))(?![A-Za-z]))?` +
    String.raw`(?:${GAP}?(?<post>(?:${CODE}))\b)?` +
    String.raw`(?<plus>${GAP}?\+)?`,
  'g'
);
const RANGE_GAP = new RegExp(String.raw`^${GAP}?(?:-|–|—|to|and)${GAP}?$`, 'i');
const UP_TO = new RegExp(String.raw`\bup${GAP}to${GAP}?$`, 'i');
const BETWEEN = new RegExp(String.raw`\bbetween${GAP}?$`, 'i');

interface Atom {
  start: number;
  end: number;
  /** null: no currency written; 'conflict': unreadable (CA$, "$5 EUR", "$5+"). */
  currency: string | null | 'conflict';
  /** Value before the multiplier, in hundredths; null when ambiguous. */
  base: number | null;
  mult: number | null;
}

/**
 * The one normalization both sides use before reading amounts. Scripts,
 * styles, noscript and template blocks are dropped (an unclosed one drops
 * the rest of the page), every other tag becomes a TAG mark, entities are
 * decoded, U+2009 and U+202F become U+202F, and every other run of
 * whitespace and tag marks becomes one space, or one TAG mark when it held
 * a tag. Linear in the input.
 */
export function normalizeMoneyText(input: string): string {
  const html = (input || '').replace(/[\ue000\ue001]/g, ' ');
  const named: Record<string, string> = {
    nbsp: ' ', amp: '&', dollar: '$', euro: '€', pound: '£', ndash: '–', mdash: '—', thinsp: THIN, quot: '"', apos: "'",
  };
  // The same linear stripping as normalizeForMatch (html-text.ts).
  return stripTags(stripHiddenBlocks(html, TAG), TAG)
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (_entity, code: string) => {
      const lower = code.toLowerCase();
      if (!lower.startsWith('#')) return named[lower] ?? ' ';
      const point = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      if (!Number.isFinite(point) || point <= 0 || point > 0x10ffff) return ' ';
      const char = String.fromCodePoint(point);
      return char === '<' || char === '>' || char === TAG ? ' ' : char;
    })
    .replace(/[\u2009\u202f]/g, THIN)
    .replace(/(?:[^\S\u202f]|\ue000)+/g, (run) => (run.includes(TAG) ? TAG : ' '))
    .replace(/^[ \ue000]+|[ \ue000]+$/g, '');
}

/** Normalized text as a reader would quote it. */
function display(text: string): string {
  return text.replace(/\ue000/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/** Hundredths of a written number, or null when its form is ambiguous. */
function parseNumber(raw: string, hasMultiplier: boolean): number | null {
  const grouped = new RegExp(String.raw`^(\d{1,3})(${SEP})(\d{3}(?:\2\d{3})*)(?:([.,])(\d{1,2}))?$`).exec(raw);
  if (grouped) {
    const [, head, sep, rest, dec, frac] = grouped;
    // "1.500M" or "2,500k": a decimal point or a thousands group? Refuse.
    if (hasMultiplier && (sep === '.' || sep === ',')) return null;
    if (dec && dec === sep) return null;
    const whole = Number(head + rest.split(sep).join(''));
    return whole * 100 + (frac ? Number(frac.padEnd(2, '0')) : 0);
  }
  const plain = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(raw);
  if (!plain) return null;
  return Number(plain[1]) * 100 + (plain[2] ? Number(plain[2].padEnd(2, '0')) : 0);
}

function readAtom(match: RegExpExecArray, text: string): Atom {
  const g = match.groups || {};
  const start = match.index;
  const end = start + match[0].length;
  let currency: Atom['currency'] = null;
  const prefix = g.sym ? SYMBOLS[g.sym] : g.pre || null;
  // "CA$", "A$", "NZ$": a dollar, but not the US one.
  if (g.sym === '$' && /[A-Za-z]/.test(text.charAt(start - 1))) currency = 'conflict';
  else if (prefix && g.post && prefix !== g.post) currency = 'conflict';
  else currency = prefix || g.post || null;
  if (g.plus) currency = 'conflict';
  const word = g.mult || g.multWord;
  const mult = word ? MULTIPLIERS[word.toLowerCase()] ?? null : null;
  return { start, end, currency, base: parseNumber(g.num, Boolean(word)), mult };
}

function value(atom: Atom, mult: number | null): number | null {
  if (atom.base === null) return null;
  return Math.round(atom.base * (mult ?? 1));
}

/** Every amount expression in normalized `text` (see normalizeMoneyText):
 *  single amounts with a currency, and ranges ("$50,000–$100,000",
 *  "50k–100k EUR", "between $5k and $10k"). An expression whose currency or
 *  value cannot be read with certainty is left out, and so are the numbers
 *  inside it. Reads at most MAX_SCAN_CHARS and MAX_ATOMS. */
export function scanMoney(input: string): MoneyScan {
  let text = input;
  let truncated = false;
  if (text.length > MAX_SCAN_CHARS) {
    truncated = true;
    text = text.slice(0, MAX_SCAN_CHARS);
    // Never read a number cut in half at the cap.
    text = text.slice(0, Math.max(text.lastIndexOf(' '), text.lastIndexOf(TAG), 0));
  }
  const atoms: Atom[] = [];
  ATOM.lastIndex = 0;
  for (const match of text.matchAll(ATOM)) {
    if (atoms.length === MAX_ATOMS) {
      truncated = true;
      // The last one read may open a range that continues past the cap.
      atoms.pop();
      break;
    }
    atoms.push(readAtom(match, text));
  }
  const exprs: MoneyExpr[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const b = atoms[i + 1];
    const windowStart = Math.max(0, a.start - LOOKBACK);
    const back = text.slice(windowStart, a.start);
    const gap = b && b.start - a.end <= 8 ? text.slice(a.end, b.start) : null;
    const isRange = gap !== null && RANGE_GAP.test(gap) && (!/and/i.test(gap) || BETWEEN.test(back));
    const upAt = back.search(UP_TO);
    const upTo = upAt >= 0;
    const textStart = upTo ? windowStart + upAt : a.start;
    if (isRange) {
      i++;
      if (a.currency === 'conflict' || b.currency === 'conflict') continue;
      if (a.currency && b.currency && a.currency !== b.currency) continue;
      const currency = a.currency || b.currency;
      // "$50-100k": is the first 50 or 50k? Refuse rather than guess.
      if (!currency || Boolean(a.mult) !== Boolean(b.mult)) continue;
      const min = value(a, a.mult);
      const max = value(b, b.mult);
      if (min === null || max === null || min >= max) continue;
      exprs.push({ currency, min, max, range: true, upTo, text: display(text.slice(textStart, b.end)), start: textStart, end: b.end });
      continue;
    }
    if (!a.currency || a.currency === 'conflict') continue;
    const amount = value(a, a.mult);
    if (amount === null) continue;
    exprs.push({ currency: a.currency, min: amount, max: amount, range: false, upTo, text: display(text.slice(textStart, a.end)), start: textStart, end: a.end });
  }
  return { exprs, truncated };
}

export function findMoney(text: string): MoneyExpr[] {
  return scanMoney(text).exprs;
}

/** A Wire amount: one money expression at the start, then an optional short
 *  qualifier ("budget", "per team", "pool"). */
export interface ParsedAmount {
  money: MoneyExpr;
  /** Lowercase plain words, empty when the amount is money alone. */
  qualifier: string[];
}

export const QUALIFIER_MAX_WORDS = 4;

/** A proposal amount read whole, after the same normalization as the page:
 *  one money expression at the very start, then nothing or 1 to
 *  QUALIFIER_MAX_WORDS plain words (ASCII letters only, no digits). Null for
 *  anything else ("$75,000 for 10 teams", "varies", "between $5k and $10k",
 *  "$75,000/yr", "$75 000", any markup or entity). */
export function parseAmount(raw: unknown): ParsedAmount | null {
  if (typeof raw !== 'string' || raw.length > 80 || /[<>&\ue000\ue001]/.test(raw)) return null;
  const text = normalizeMoneyText(raw);
  if (!text) return null;
  const found = findMoney(text);
  const money = found[0];
  if (!money || money.start !== 0) return null;
  const rest = text.slice(money.end);
  if (!rest) return found.length === 1 ? { money, qualifier: [] } : null;
  if (!rest.startsWith(' ')) return null;
  const words = rest.trim().split(' ');
  if (words.length > QUALIFIER_MAX_WORDS || !words.every((word) => /^[A-Za-z]+$/.test(word))) return null;
  return { money, qualifier: words.map((word) => word.toLowerCase()) };
}

/** A proposal amount that is money and nothing else. */
export function parseMoney(raw: unknown): MoneyExpr | null {
  const parsed = parseAmount(raw);
  return parsed && parsed.qualifier.length === 0 ? parsed.money : null;
}

/** The page's visible text for amount matching (normalizeMoneyText). */
export const visibleMoneyText = normalizeMoneyText;

function moneyOnPage(amount: MoneyExpr, pageText: string): { hits: MoneyExpr[]; truncated: boolean } {
  const scan = scanMoney(pageText);
  const hits = scan.exprs.filter((expr) =>
    expr.currency === amount.currency && expr.range === amount.range &&
    expr.min === amount.min && expr.max === amount.max && (!amount.upTo || expr.upTo)
  );
  return { hits, truncated: scan.truncated };
}

/**
 * Where the normalized page states the proposal's amount: the same currency
 * and the same value. A single amount matches a single amount on the page,
 * bare or after "up to"; an "up to" amount needs "up to" on the page too; a
 * range needs the same range. A range endpoint never stands in for a single
 * amount.
 */
export function findAmountOnPage(amount: MoneyExpr, pageText: string): MoneyExpr | null {
  return moneyOnPage(amount, pageText).hits[0] ?? null;
}

export type AmountMatch =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: 'amount_not_on_page' | 'amount_qualifier_not_on_page'; truncated: boolean };

/**
 * The normalized page states the whole Wire amount: the money matches under
 * findAmountOnPage, and when the amount has a qualifier, that same money
 * mention is followed directly by the qualifier's words, in order, in the
 * same sentence ("$75k budget" states "$75,000 budget"; "$75,000 pool" does
 * not state "$75,000 per team"). Between words only spaces, tags, hyphens,
 * dashes or a slash may stand; a sentence stop, comma or anything else breaks it.
 */
export function matchAmountOnPage(amount: ParsedAmount, pageText: string): AmountMatch {
  const { hits, truncated } = moneyOnPage(amount.money, pageText);
  if (!hits.length) return { ok: false, reason: 'amount_not_on_page', truncated };
  if (!amount.qualifier.length) return { ok: true, text: hits[0].text, truncated };
  // Sticky: tried only at the end of each hit, never scanned across the page.
  const phrase = new RegExp(`[ \\uE000]+${amount.qualifier.join('[ \\uE000\\-–—/]+')}(?![A-Za-z0-9])`, 'iy');
  for (const hit of hits) {
    phrase.lastIndex = hit.end;
    const tail = phrase.exec(pageText);
    if (tail) return { ok: true, text: display(pageText.slice(hit.start, hit.end + tail[0].length)), truncated };
  }
  return { ok: false, reason: 'amount_qualifier_not_on_page', truncated };
}
