import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const runtime = pathToFileURL(require.resolve('react/jsx-runtime')).href;
const display = new URL('../src/lib/funding-display.ts', import.meta.url).href;
const classification = new URL('../src/lib/program-classification.ts', import.meta.url).href;
function componentModule(path, imports) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [name, url] of Object.entries({ 'react/jsx-runtime': runtime, ...imports })) {
    code = code.replaceAll(`'${name}'`, JSON.stringify(url)).replaceAll(`"${name}"`, JSON.stringify(url));
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const terms = componentModule('../src/components/funding/funding-terms.tsx', { '../../lib/funding-display': display });
const record = componentModule('../src/components/funding/funding-record.tsx', {
  'next/link': pathToFileURL(require.resolve('next/link')).href,
  '../../lib/funding-display': display,
  '../../lib/program-classification': classification,
  './funding-terms': terms,
});
const { FundingRecord } = await import(record);
const render = (row, kind) => renderToStaticMarkup(createElement(FundingRecord, { row, kind, programName: 'Readable program name' }));

test('history records retain their own title when a program name is supplied', () => {
  const html = render({id:'history',program:'program-id',label:'Endowment established',summary:'Published history.'}, 'changes');
  assert.match(html, /<h3[^>]*><a[^>]*>Endowment established<\/a><\/h3>/);
  assert.doesNotMatch(html, /<h3[^>]*><a[^>]*>Readable program name<\/a><\/h3>/);
});

test('recipient titles remain separate from program links and unknown payments', () => {
  for (const [kind, nameField] of [['funding-events','recipient_name'],['outputs','name']]) {
    const html = render({id:'record',program:'program-id',[nameField]:'Recipient project',amount:{amount:'50000',currency:'USD',unit:'currency',qualifier:'up_to'}}, kind);
    assert.match(html, /<h3[^>]*>Recipient project<\/h3>/);
    assert.match(html, /Program: <a[^>]*href="\/programs\/program-id"[^>]*>Readable program name<\/a>/);
    if (kind === 'funding-events') {
      assert.ok(html.includes('Up to USD 50,000'));
      assert.ok(html.includes('Payment not established'));
    }
  }
});

test('program terms use the readable program name when no record title exists', () => {
  const html = render({id:'terms',program:'program-id'}, 'program-terms');
  assert.match(html, /<h3[^>]*><a[^>]*>Readable program name<\/a><\/h3>/);
});
