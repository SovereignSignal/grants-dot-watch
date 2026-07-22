import assert from 'node:assert/strict';
import test from 'node:test';

import { citeDate, dateShortIso } from '../src/app/admin/desk/desk-format.ts';

test('Desk timestamps use the product Pacific calendar date', () => {
  const timestamp = '2026-07-22T02:48:12Z';
  assert.equal(dateShortIso(timestamp), 'Jul 21, 2026');
  assert.equal(citeDate(timestamp), 'Jul 21');
});
