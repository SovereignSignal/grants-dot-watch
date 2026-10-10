import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { buildFundingCollections, memoBySnapshot } from '../src/lib/funding-api.mjs';
import { buildFundingProduct, cachedFundingProduct } from '../src/lib/funding-product.mjs';
import { readBaseline } from '../src/lib/funding-store.mjs';
import { readControlledFunding } from '../src/lib/funding-desk-core.mjs';

const SOURCE = 'https://funder.example.org/grants';
const baseline = (closes_at) => ({ systems: [], awards: [], orgs: [{ id: 'funder', name: 'Funder', status: 'active', profile: 'Public profile', sources: [SOURCE] }],
  programs: [{ id: 'program', org: 'funder', name: 'Program', status: 'active', apply_url: `${SOURCE}/apply`, summary: 'Public program', sources: [SOURCE],
    rounds: [{ name: 'Current', status: 'open', opens: '2026-09-01', closes: '2026-10-04', ...(closes_at ? { closes_at } : {}), source: SOURCE }] }] });
const dataset = () => ({ 'program-terms': [], 'funding-events': [], 'process-metrics': [] });
const counting = () => { let builds = 0; const fn = memoBySnapshot((b, d, at) => { builds++; return { b, d, at }; }); return { fn, builds: () => builds }; };
const AT = new Date('2026-10-04T15:00:00Z');

test('the same verified snapshot on the same day reuses one build', () => {
  const { fn, builds } = counting(), b = baseline(), snap = { baseline: b, dataset: dataset(), control: { hash: 'h1' } };
  const first = fn(snap, AT), second = fn({ ...snap, dataset: dataset() }, new Date('2026-10-04T18:00:00Z'));
  assert.equal(builds(), 1); assert.equal(first, second);
});
test('a new control hash, a new registry object or a new day forces a fresh build', () => {
  const { fn, builds } = counting(), b = baseline();
  fn({ baseline: b, dataset: dataset(), control: { hash: 'h1' } }, AT);
  fn({ baseline: b, dataset: dataset(), control: { hash: 'h2' } }, AT); assert.equal(builds(), 2);
  fn({ baseline: baseline(), dataset: dataset(), control: { hash: 'h2' } }, AT); assert.equal(builds(), 3);
  fn({ baseline: b, dataset: dataset(), control: { hash: 'h2' } }, new Date('2026-10-05T15:00:00Z')); assert.equal(builds(), 4);
});
test('snapshots without a control hash are never cached', () => {
  const { fn, builds } = counting(), snap = { baseline: baseline(), dataset: dataset() };
  fn(snap, AT); fn(snap, AT); assert.equal(builds(), 2);
});
test('an exact closes_at cutoff ends the cached entry, so the opportunity disappears on time', () => {
  const collections = memoBySnapshot(buildFundingCollections), b = baseline('2026-10-04T16:00:00Z');
  const snap = { baseline: b, dataset: dataset(), control: { hash: 'h1' } };
  assert.equal(collections(snap, AT).opportunities.length, 1);
  assert.equal(collections(snap, new Date('2026-10-04T15:59:59Z')).opportunities.length, 1);
  assert.equal(collections(snap, new Date('2026-10-04T16:00:00Z')).opportunities.length, 0);
});
test('a cached product equals a fresh build on the real registry', () => {
  const root = 'registry', at = new Date();
  const { dataset: data, control } = readControlledFunding(root), b = readBaseline(root, YAML.parse);
  const snap = { baseline: b, dataset: data, control };
  const fresh = JSON.stringify(buildFundingProduct(b, data, at));
  assert.equal(JSON.stringify(cachedFundingProduct(snap, at)), fresh);
  assert.equal(JSON.stringify(cachedFundingProduct(snap, at)), fresh);
});
