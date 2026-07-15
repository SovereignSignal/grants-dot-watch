import assert from 'node:assert/strict';
import test from 'node:test';

import { paginate, paginationItems, parsePage } from '../src/lib/pagination.ts';

test('page parsing accepts positive integers only', () => {
  assert.equal(parsePage('3'), 3);
  assert.equal(parsePage('0'), 1);
  assert.equal(parsePage('-2'), 1);
  assert.equal(parsePage('1.5'), 1);
  assert.equal(parsePage(undefined), 1);
});

test('pagination clamps bounds and reports the visible range', () => {
  const values = Array.from({ length: 121 }, (_, index) => index + 1);
  const middle = paginate(values, 2, 50);
  assert.deepEqual([middle.items[0], middle.items.at(-1)], [51, 100]);
  assert.deepEqual([middle.page, middle.totalPages, middle.start, middle.end], [2, 3, 51, 100]);

  const last = paginate(values, 99, 50);
  assert.deepEqual([last.page, last.start, last.end, last.items.length], [3, 101, 121, 21]);
});

test('large page sets keep a bounded navigation window', () => {
  assert.deepEqual(paginationItems(1, 20), [1, 2, 'ellipsis', 20]);
  assert.deepEqual(paginationItems(10, 20), [1, 'ellipsis', 9, 10, 11, 'ellipsis', 20]);
  assert.deepEqual(paginationItems(20, 20), [1, 'ellipsis', 19, 20]);
});
