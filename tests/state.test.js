import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reserve, settle, markFailed, spentOn, heldOn, spentByDay, today, reconcile, keyTag, BudgetExceeded, RESERVE_USD } from '../lib/budget.js';
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

// Reconciliation against the key's lifetime usage on OpenRouter: entries are tagged with the key they were sent with.
const T = 'k1', MIN = 60_000;
function ledgerWith(...specs) {
  let l = { entries: [] };
  specs.forEach(([id, outcome, at = 0, tag = T]) => {
    l = reserve(l, { id, day, limitUsd: 10, keyTag: tag, at });
    if (typeof outcome === 'number') l = settle(l, id, outcome);
    if (outcome === 'lost') l = markFailed(l, id, 'Load failed');
  });
  return l;
}

test('reconcile releases lost reservations the key usage does not account for', () => {
  const l = reconcile(ledgerWith(['a', 0.0006], ['b', 'lost'], ['c', 'lost']), { keyTag: T, usageUsd: 0.0006, now: 20 * MIN });
  assert.equal(heldOn(l, day), 0);
  assert.equal(spentOn(l, day), 0.0006);
  assert.equal(l.entries[1].reconciled, true);
});

test('reconcile charges lost reservations up to the unexplained usage, oldest first', () => {
  const l = reconcile(ledgerWith(['a', 0.0006], ['b', 'lost'], ['c', 'lost']), { keyTag: T, usageUsd: 0.0306, now: 20 * MIN });
  assert.deepEqual(l.entries.map((e) => e.chargedUsd), [0.0006, 0.02, 0.01]);
  assert.equal(heldOn(l, day), 0);
});

test('reconcile waits a minute: recent losses, requests in flight, other keys and unknown usage are left alone', () => {
  const base = ledgerWith(['a', 0.0006], ['b', 'lost', 20 * MIN - 30_000]);
  assert.deepEqual(reconcile(base, { keyTag: T, usageUsd: 0.0006, now: 20 * MIN }), base); // b is 30 s old
  assert.equal(heldOn(reconcile(base, { keyTag: T, usageUsd: 0.0006, now: 20 * MIN + 31_000 }), day), 0); // 61 s old
  const flying = ledgerWith(['a', 'lost'], ['b', 'flight', 20 * MIN - 30_000]);
  assert.deepEqual(reconcile(flying, { keyTag: T, usageUsd: 0, now: 20 * MIN }), flying);
  const dead = reconcile(ledgerWith(['a', 'flight']), { keyTag: T, usageUsd: 0, now: 20 * MIN }); // worker died mid-request
  assert.equal(heldOn(dead, day), 0);
  const other = ledgerWith(['a', 'lost', 0, 'old']);
  assert.deepEqual(reconcile(other, { keyTag: T, usageUsd: 0, now: 20 * MIN }), other);
  assert.deepEqual(reconcile(base, { keyTag: T, usageUsd: null, now: 20 * MIN }), base);
});

test('keyTag is short, stable and does not contain the key', () => {
  assert.equal(keyTag('sk-or-v1-abc'), keyTag('sk-or-v1-abc'));
  assert.notEqual(keyTag('sk-or-v1-abc'), keyTag('sk-or-v1-abd'));
  assert.match(keyTag('sk-or-v1-abc'), /^[0-9a-f]{8}$/);
});
