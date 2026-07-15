import assert from 'node:assert/strict';
import test from 'node:test';

import { filterAwards } from '../src/lib/award-browse.ts';

const awards = [
  {
    funder: 'alpha-foundation',
    funder_name: 'Alpha Foundation',
    grantee: 'open-tools',
    grantee_name: 'Open Tools',
    currency: 'USD',
    date: '2026-02-03',
    program: 'builder-fund',
    program_name: 'Builder Fund',
    wire: 'oss',
  },
  {
    funder: 'beta-dao',
    funder_name: 'Beta DAO',
    grantee: 'research-lab',
    grantee_name: 'Research Lab',
    currency: null,
    date: null,
    program: null,
    program_name: 'Safety Research',
    wire: 'ai',
  },
];

test('award browse filters compose across fields', () => {
  assert.deepEqual(filterAwards(awards, { wire: 'oss', year: '2026', currency: 'usd' }), [awards[0]]);
  assert.deepEqual(filterAwards(awards, { wire: 'oss', funder: 'beta-dao' }), []);
  assert.deepEqual(filterAwards(awards, { year: 'undated', currency: 'unspecified' }), [awards[1]]);
});

test('award browse search covers recipient, funder, and program', () => {
  assert.deepEqual(filterAwards(awards, { q: 'open tools' }), [awards[0]]);
  assert.deepEqual(filterAwards(awards, { q: 'beta' }), [awards[1]]);
  assert.deepEqual(filterAwards(awards, { q: 'safety research' }), [awards[1]]);
  assert.deepEqual(filterAwards(awards, { q: 'missing' }), []);
});
