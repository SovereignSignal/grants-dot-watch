import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Compile the real leaf component with the installed TypeScript compiler.
// No registry mutation, network, browser server or fixture-only copy is used.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/components/funding/funding-terms.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const runtime = pathToFileURL(require.resolve('react/jsx-runtime')).href;
const displayModule = new URL('../src/lib/funding-display.ts', import.meta.url).href;
const code = compiled.replaceAll('"react/jsx-runtime"', JSON.stringify(runtime)).replace(/(['"])\.\.\/\.\.\/lib\/funding-display\1/g, JSON.stringify(displayModule));
const { FundingTerms } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const render = row => renderToStaticMarkup(createElement(FundingTerms, { row }));

test('funding terms render an initial award ceiling with its restrictions', () => {
  const html = render({ round_name:'First call', resources:[{kind:'cash',value:{amount:'50000',currency:'EUR',unit:'currency',qualifier:'up_to',amount_text:'EUR 5,000 to EUR 50,000'},restrictions:['Initial proposal range; not an awarded amount.']}], access:{stage:'Initial project proposal',state:'open',checked_on:'2026-10-04',review_after:'2026-10-11'}, eligibility:['European dimension required'] });
  for (const text of ['Up to EUR 50,000','Initial proposal range','First call','Initial project proposal','European dimension required','not determine an individual']) assert.ok(html.includes(text),text);
});
test('funding terms preserve distinct financing components without inventing a total', () => {
  const html = render({resources:[{kind:'cash',value:{amount:'125000',currency:'USD',unit:'currency',qualifier:'exact'},restrictions:['SAFE for fixed 7%']},{kind:'cash',value:{amount:'375000',currency:'USD',unit:'currency',qualifier:'exact'},restrictions:['Uncapped MFN SAFE']}]});
  for(const text of ['USD 125,000','USD 375,000','SAFE for fixed 7%','Uncapped MFN SAFE','separately conditioned'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('USD 500,000'));
});
test('funding terms show subsidy alternatives and do not turn unknown values into cash', () => {
  const html = render({resources:[{kind:'service',value:{amount:null,currency:null,unit:'audit service',qualifier:'not_disclosed',amount_text:'25%, 50%, or 100% audit-invoice subsidies'},restrictions:['No cash disbursement.']}], evidence_note:'Indicative monetary ceilings are disputed.'});
  assert.ok(html.includes('25%, 50%, or 100%'));
  assert.ok(html.includes('No cash disbursement.'));
  assert.ok(html.includes('Indicative monetary ceilings are disputed.'));
  assert.ok(!html.includes('USD'));
});
test('funding terms escape source-provided prose and tolerate absent optional fields', () => {
  const html = render({resources:[{kind:'service',value:{amount:null},restrictions:['<script>not executable</script>']}],requirements:['A & B']});
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Amount not disclosed'));
  assert.ok(render({}).includes('<div'));
});
test('an access check reads as a dated note, not an expiring review', () => {
  const html = render({ resources:[], access:{ round_name:'First call', stage:'Initial project proposal', state:'open', new_applicants:true, prerequisites_clear:true, route:'https://nlnet.nl/propose/', checked_on:'2026-10-04', review_after:'2026-10-11', source:'https://nlnet.nl/codesupply/' } });
  assert.ok(html.includes('Recorded intake state: Open, noted 2026-10-04.'));
  assert.ok(!/review due|2026-10-11/i.test(html));
});

test('funding terms display recorded effective dates without filling missing bounds', () => {
  assert.ok(render({effective_from:'2025-01-01',effective_to:'2025-12-31'}).includes('Terms effective: 2025-01-01 to 2025-12-31.'));
  assert.ok(render({effective_to:'2025-12-31'}).includes('Start not recorded to 2025-12-31.'));
  assert.ok(render({effective_from:'2025-01-01'}).includes('2025-01-01 to End not recorded.'));
  assert.ok(!render({}).includes('Terms effective:'));
});
