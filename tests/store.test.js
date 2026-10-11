import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js';
import { reserve, BudgetExceeded } from '../lib/budget.js';

function memoryArea() {
  const data = {};
  return {
    data,
    get: async (k) => { await new Promise((r) => setTimeout(r, Math.random() * 3)); return k in data ? { [k]: structuredClone(data[k]) } : {}; },
    set: async (o) => { await new Promise((r) => setTimeout(r, Math.random() * 3)); Object.assign(data, structuredClone(o)); },
  };
}

test('concurrent mutations are serialized, so parallel reservations respect the limit', async () => {
  const area = memoryArea();
  const store = createStore(area);
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) =>
    store.mutate('budget', { entries: [] }, (l) => reserve(l, { id: String(i), day: 'd', limitUsd: 0.1 }))));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason instanceof BudgetExceeded));
  assert.equal(area.data.budget.entries.length, 5);
});
