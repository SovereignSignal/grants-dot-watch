import test from 'node:test';
import assert from 'node:assert/strict';

import { dateLong, editionCode } from '../src/lib/format.ts';

test('full timestamps render in the product Pacific timezone', () => {
  const timestamp = '2026-07-22T02:48:12Z';
  assert.equal(dateLong(timestamp), 'July 21, 2026');
  assert.equal(editionCode(timestamp), '2026.07.21');
});

test('plain registry dates preserve their literal calendar date', () => {
  const date = '2026-07-22';
  assert.equal(dateLong(date), 'July 22, 2026');
  assert.equal(editionCode(date), '2026.07.22');
});
