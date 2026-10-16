import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reserve, settle, markFailed, spentOn, heldOn, spentByDay, today, BudgetExceeded, RESERVE_USD } from '../lib/budget.js';
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

test('heldOn counts only reservations whose real cost never came back', () => {
  let l = { entries: [] };
  for (const id of ['ok', 'gone', 'flight', 'refused', 'odd']) l = reserve(l, { id, day, limitUsd: 1 });
  l = settle(l, 'ok', 0.0006);
  l = markFailed(l, 'gone', 'Load failed');
  l = settle(markFailed(l, 'refused', 'http_451'), 'refused', 0);
  l = settle(markFailed(l, 'odd', 'invalid_response:c001'), 'odd', 0.02); // a real cost equal to the reserve is still real
  assert.equal(heldOn(l, day), 2 * RESERVE_USD); // 'gone' + 'flight'
  assert.equal(spentOn(l, day), 0.0606); // the limit still counts the held ones
  // Ledgers written before 'known' existed: a failed entry still at the reserve is unconfirmed, one at 0 was settled.
  const legacy = { entries: [{ id: 'x', day, status: 'failed', chargedUsd: RESERVE_USD }, { id: 'y', day, status: 'failed', chargedUsd: 0 }] };
  assert.equal(heldOn(legacy, day), RESERVE_USD);
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
