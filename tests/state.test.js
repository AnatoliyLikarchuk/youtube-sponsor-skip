import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reserve, settle, markFailed, spentOn, spentByDay, today, BudgetExceeded, RESERVE_USD } from '../lib/budget.js';
import { getEntry, putEntry } from '../lib/cache.js';

const day = '2026-10-11';

test('reserve appends a pessimistic entry and settle lowers it to the real cost', () => {
  let l = reserve({ entries: [] }, { id: 'a', day, limitUsd: 0.2 });
  assert.equal(spentOn(l, day), RESERVE_USD);
  l = settle(l, 'a', 0.0007);
  assert.equal(spentOn(l, day), 0.0007);
  assert.equal(l.entries[0].status, 'settled');
});

test('unknown cost and failures keep the reservation; entries are never removed', () => {
  let l = reserve({ entries: [] }, { id: 'a', day, limitUsd: 0.2 });
  l = reserve(l, { id: 'b', day, limitUsd: 0.2 });
  l = settle(l, 'a', null);
  l = markFailed(l, 'b', 'http_500');
  assert.equal(l.entries.length, 2);
  assert.equal(spentOn(l, day), 2 * RESERVE_USD);
  assert.deepEqual(l.entries.map((e) => e.status), ['reserved', 'failed']);
});

test('reserve refuses when in-flight reservations would cross the limit', () => {
  let l = { entries: [] };
  for (const id of ['a', 'b', 'c']) l = reserve(l, { id, day, limitUsd: 0.07 });
  assert.throws(() => reserve(l, { id: 'd', day, limitUsd: 0.07 }), BudgetExceeded);
});

test('limit is per day', () => {
  let l = reserve({ entries: [] }, { id: 'a', day: '2026-10-10', limitUsd: 0.02 });
  l = reserve(l, { id: 'b', day, limitUsd: 0.02 });
  assert.deepEqual(spentByDay(l), { '2026-10-10': 0.02, [day]: 0.02 });
});

test('today is a local YYYY-MM-DD date', () => {
  assert.equal(today(new Date(2026, 9, 11, 23, 59)), '2026-10-11');
});

test('cache returns entries only for the current version and evicts the oldest', () => {
  let c = {};
  c = putEntry(c, 'v1', { segments: [] }, 'A', 2, 1);
  c = putEntry(c, 'v2', { segments: [{ start: 1, end: 9 }] }, 'A', 2, 2);
  assert.equal(getEntry(c, 'v1', 'B'), null);
  assert.deepEqual(getEntry(c, 'v2', 'A').segments, [{ start: 1, end: 9 }]);
  c = putEntry(c, 'v3', { segments: [] }, 'A', 2, 3);
  assert.deepEqual(Object.keys(c).sort(), ['v2', 'v3']);
});
