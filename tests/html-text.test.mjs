import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripHiddenBlocks, stripTags } from '../src/lib/html-text.ts';
import { nameOnPage, normalizeForMatch, pageContainsDate } from '../src/lib/proposal-validator.ts';
import { findMoney, normalizeMoneyText } from '../src/lib/money-match.ts';

/** normalizeForMatch as it was before the linear stripper (the reference). */
function referenceNormalizeForMatch(s) {
  const visibleText = (s || '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, ' ');
  return visibleText.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', '.claude'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(path, out);
    else if (/\.html?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const REAL_LOOKING = [
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Builder Grants | Example Foundation</title>
<script type="application/ld+json">{"@type":"Event","name":"Builder Grants <b>2026</b>","endDate":"2026-11-30"}</script>
<style>.apply > a { color: red } body::before { content: "<p>"; }</style>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
<SCRIPT>window.dataLayer = []; if (a < b && c > d) { document.write("</div>"); }</SCRIPT>
</head><body><noscript><iframe src="https://www.googletagmanager.com/ns.html"></iframe></noscript>
<header><nav><a href="/">Home</a> &middot; <a href="/grants" title="Grants > Builder">Grants</a></nav></header>
<main><h1>Example Builder&nbsp;Grants</h1><p>Applications are open. Grants of up to $75,000 per team.</p>
<p>Deadline: <time datetime="2026-11-30">November 30, 2026</time>.</p>
<template id="row"><tr><td>Hidden template row</td></tr></template>
<!-- <script>commented()</script> --><p>Résumé &amp; café: a < b and c > d.</p><p>Empty <> brackets.</p></main>
<script>
  // inline analytics
  var s = '<template>';
</script></body></html>`,
  `<html><body><div class="grant"><h2>Season 9 Open Call</h2><p>Apply now on our portal.</p>
<STYLE type="text/css">p{margin:0}</STYLE><Script>var x = "Applications closed";</Script>
<p>Funding: €50.000 per project &#8212; rolling basis.</p><img alt="logo"><br/><p>Contact us</p></div></body></html>`,
  `<p>Plain fragment with <b>bold</b>, <i>italic</i>, 3 < 4, and a <a href="https://example.org/apply?x=1&amp;y=2">link</a>.</p>`,
];

test('normalizeForMatch is unchanged on well-formed pages', () => {
  const files = htmlFiles(process.cwd());
  assert.ok(files.length >= 5, `found ${files.length} HTML files`);
  const pages = [...files.map((file) => readFileSync(file, 'utf8')), ...REAL_LOOKING];
  for (const [i, page] of pages.entries()) {
    assert.equal(normalizeForMatch(page), referenceNormalizeForMatch(page), files[i] ?? `real-looking page ${i - files.length}`);
    assert.equal(stripTags(page, ' '), page.replace(/<[^>]+>/g, ' '), `tags: ${files[i] ?? i}`);
    assert.equal(
      stripHiddenBlocks(page, ' '),
      page.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '),
      `blocks: ${files[i] ?? i}`
    );
  }
  // Short strings: names, dates, odd brackets.
  for (const s of ['Example Builder Fund', 'Señal Café Grants', 'November 30, 2026', 'a <> b', '<<a>>', 'x > y < z', '<', '>', '', '<b>', '<<>>']) {
    assert.equal(normalizeForMatch(s), referenceNormalizeForMatch(s), JSON.stringify(s));
    assert.equal(stripTags(s, '|'), s.replace(/<[^>]+>/g, '|'), JSON.stringify(s));
  }
});

test('an unclosed script, style, noscript or template hides the rest of the page', () => {
  assert.equal(normalizeForMatch('<p>Apply now</p><script>var a = 1; <p>Example Fund</p>'), 'apply now');
  assert.equal(normalizeForMatch('<p>Apply now</p><style <p>Example Fund</p>'), 'apply now');
  assert.equal(nameOnPage('<h1>Intro</h1><noscript><h1>Example Builder Fund</h1>', 'Example Builder Fund'), false);
  assert.equal(pageContainsDate('<template><p>November 30, 2026</p>', '2026-11-30'), false);
  // A closed block before it still counts as closed.
  assert.equal(normalizeForMatch('<script>x</script><p>Example Fund</p><script>y'), 'example fund');
});

const within = (label, fn) => {
  const started = performance.now();
  fn();
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `${label}: ${elapsed.toFixed(0)} ms`);
  return elapsed;
};

test('1 MB adversarial pages read in linear time', () => {
  const pages = {
    'unclosed script openers': '<script>'.repeat(131_072),
    'openers with no ">"': '<script '.repeat(131_072),
    'openers and "<" noise': ('<script x' + '<'.repeat(23)).repeat(32_768),
    'stray "<"': '<'.repeat(1_048_576),
    'closers without openers': '</script>'.repeat(116_508),
    'mixed openers and text': '<style>a<noscript>b<template>c<script>d '.repeat(26_214),
    'entities and digits': ('&#' + '9'.repeat(30) + '&nbsp' ).repeat(28_000),
  };
  for (const [label, page] of Object.entries(pages)) {
    assert.ok(page.length >= 1_000_000, label);
    within(`normalizeForMatch: ${label}`, () => normalizeForMatch(page));
    within(`nameOnPage: ${label}`, () => nameOnPage(page, 'Example Builder Fund'));
    within(`pageContainsDate: ${label}`, () => pageContainsDate(page, '2026-11-30'));
    within(`normalizeMoneyText: ${label}`, () => findMoney(normalizeMoneyText(page)));
  }
});
