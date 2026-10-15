// Amount matching for the Wire program auto-apply. A Wire amount (a round
// `size`) may publish without the owner only when the same amount, in the
// same currency, is written on the fetched page. Both sides go through one
// grammar, so "$75,000", "$75k", "75,000 USD" and "USD 75,000" are one value,
// and a number is always read whole: 175,000 is never 75,000.
//
// The grammar is narrow on purpose. Anything it cannot read with certainty
// (no currency, extra words, a lone multiplier in a range, "1.500M") is no
// amount at all: on the proposal side that leaves the item for the owner, and
// on the page side that mention simply does not count.

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

const SYMBOLS: Record<string, string> = { $: 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP' };
const CODES = ['USDC', 'USDT', 'USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'DAI'];
const MULTIPLIERS: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mn: 1e6, mio: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9,
};
const CODE = CODES.join('|');
/** A grouped number (one separator, groups of three, optional decimals) or a plain one. */
const NUMBER = String.raw`\d{1,3}(?<sep>[,.'’    ])\d{3}(?:\k<sep>\d{3})*(?:[.,]\d{1,2})?(?!\d|[.,]\d)|\d+(?:[.,]\d{1,2})?(?!\d|[.,]\d)`;
const ATOM = new RegExp(
  String.raw`(?<![\d.,])(?:(?<sym>US\$|[$€£])\s?|(?<pre>\b(?:${CODE}))\s?)?` +
    `(?<num>${NUMBER})` +
    // "75k", "1.5M", "2bn" are written tight; only a whole word may stand apart ("1 million").
    String.raw`(?:(?:(?<mult>[kK]|[mM]{1,2}|[mM]n|[bB][nN]?)|\s?(?<multWord>[tT]housand|[mM]illion|[bB]illion|[mM]io))(?![A-Za-z]))?` +
    String.raw`(?:\s?(?<post>(?:${CODE}))\b)?` +
    String.raw`(?<plus>\s?\+)?`,
  'g'
);
const RANGE_GAP = /^\s*(?:-|–|—|to|and)\s*$/i;
const UP_TO = /\bup to\s*$/i;

interface Atom {
  start: number;
  end: number;
  /** null: no currency written; 'conflict': unreadable (CA$, "$5 EUR", "$5+"). */
  currency: string | null | 'conflict';
  /** Value before the multiplier, in hundredths; null when ambiguous. */
  base: number | null;
  mult: number | null;
}

/** Hundredths of a written number, or null when its form is ambiguous. */
function parseNumber(raw: string, hasMultiplier: boolean): number | null {
  const grouped = /^(\d{1,3})([,.'’    ])(\d{3}(?:\2\d{3})*)(?:([.,])(\d{1,2}))?$/.exec(raw);
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
  if (g.sym === '$' && /[A-Za-z]$/.test(text.slice(0, start))) currency = 'conflict';
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

/** Every amount expression in `text`: single amounts with a currency, and
 *  ranges ("$50,000–$100,000", "50k–100k EUR", "between $5k and $10k"). An
 *  expression whose currency or value cannot be read with certainty is left
 *  out, and so are the numbers inside it. */
export function findMoney(text: string): MoneyExpr[] {
  const atoms: Atom[] = [];
  for (const match of text.matchAll(ATOM)) atoms.push(readAtom(match, text));
  const out: MoneyExpr[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const b = atoms[i + 1];
    const gap = b ? text.slice(a.end, b.start) : '';
    const isRange = Boolean(b) && RANGE_GAP.test(gap) && (!/and/i.test(gap) || /\bbetween\s*$/i.test(text.slice(0, a.start)));
    const before = text.slice(0, a.start);
    const upTo = UP_TO.test(before);
    const textStart = upTo ? before.search(UP_TO) : a.start;
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
      out.push({ currency, min, max, range: true, upTo, text: text.slice(textStart, b.end).trim(), start: textStart, end: b.end });
      continue;
    }
    if (!a.currency || a.currency === 'conflict') continue;
    const amount = value(a, a.mult);
    if (amount === null) continue;
    out.push({ currency: a.currency, min: amount, max: amount, range: false, upTo, text: text.slice(textStart, a.end).trim(), start: textStart, end: a.end });
  }
  return out;
}

/** A Wire amount: one money expression at the start, then an optional short
 *  qualifier ("budget", "per team", "pool"). */
export interface ParsedAmount {
  money: MoneyExpr;
  /** Lowercase plain words, empty when the amount is money alone. */
  qualifier: string[];
}

export const QUALIFIER_MAX_WORDS = 4;

/** A proposal amount read whole: one money expression at the very start,
 *  then nothing or 1 to QUALIFIER_MAX_WORDS plain words (ASCII letters only,
 *  no digits). Null for anything else ("$75,000 for 10 teams", "varies",
 *  "between $5k and $10k", "$75,000/yr"). */
export function parseAmount(raw: unknown): ParsedAmount | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 80) return null;
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

/** The page's visible text with currency signs and dashes kept: tags,
 *  scripts and styles removed, common entities decoded, whitespace collapsed. */
export function visibleMoneyText(html: string): string {
  const named: Record<string, string> = {
    nbsp: ' ', amp: '&', dollar: '$', euro: '€', pound: '£', ndash: '–', mdash: '—', thinsp: ' ', quot: '"', apos: "'", lt: ' ', gt: ' ',
  };
  return (html || '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      const lower = code.toLowerCase();
      if (lower.startsWith('#')) {
        const point = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
        const char = Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
        return char === '<' || char === '>' ? ' ' : char;
      }
      return named[lower] ?? ' ';
    })
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Where the page states the proposal's amount: the same currency and the same
 * value. A single amount matches a single amount on the page, bare or after
 * "up to"; an "up to" amount needs "up to" on the page too; a range needs the
 * same range. A range endpoint never stands in for a single amount.
 */
export function findAmountOnPage(amount: MoneyExpr, pageText: string): MoneyExpr | null {
  return moneyOnPage(amount, pageText)[0] ?? null;
}

function moneyOnPage(amount: MoneyExpr, pageText: string): MoneyExpr[] {
  return findMoney(pageText).filter((expr) =>
    expr.currency === amount.currency && expr.range === amount.range &&
    expr.min === amount.min && expr.max === amount.max && (!amount.upTo || expr.upTo)
  );
}

export type AmountMatch =
  | { ok: true; text: string }
  | { ok: false; reason: 'amount_not_on_page' | 'amount_qualifier_not_on_page' };

/**
 * The page states the whole Wire amount: the money matches under
 * findAmountOnPage, and when the amount has a qualifier, that same money
 * mention is followed directly by the qualifier's words, in order, in the
 * same sentence ("$75k budget" states "$75,000 budget"; "$75,000 pool" does
 * not state "$75,000 per team"). Between words only spaces, hyphens, dashes
 * or a slash may stand; a sentence stop, comma or anything else breaks it.
 */
export function matchAmountOnPage(amount: ParsedAmount, pageText: string): AmountMatch {
  const hits = moneyOnPage(amount.money, pageText);
  if (!hits.length) return { ok: false, reason: 'amount_not_on_page' };
  if (!amount.qualifier.length) return { ok: true, text: hits[0].text };
  const phrase = new RegExp(`^\\s+${amount.qualifier.join('[\\s\\-–—/]+')}(?![A-Za-z0-9])`, 'i');
  for (const hit of hits) {
    const tail = phrase.exec(pageText.slice(hit.end));
    if (tail) return { ok: true, text: pageText.slice(hit.start, hit.end + tail[0].length).trim() };
  }
  return { ok: false, reason: 'amount_qualifier_not_on_page' };
}
