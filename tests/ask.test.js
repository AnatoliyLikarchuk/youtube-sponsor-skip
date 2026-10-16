import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAsk } from '../lib/ask.js';
import { createStore } from '../lib/store.js';
import { HttpError, ModelMismatch, AuthError } from '../lib/jev.js';
import { spentOn, heldOn } from '../lib/budget.js';

function area() { const data = {}; return { data, get: async (k) => (k in data ? { [k]: structuredClone(data[k]) } : {}), set: async (o) => Object.assign(data, structuredClone(o)) }; }
const setup = (call) => { const a = area(); let n = 0; const ask = makeAsk({ store: createStore(a), key: 'k', limitUsd: 0.2, call, newId: () => `r${++n}`, day: () => 'd' }); return { a, ask }; };

test('success settles to the real cost', async () => {
  const { a, ask } = setup(async () => ({ probs: { c0: 0.9 }, cost: 0.001 }));
  assert.deepEqual(await ask({}), { c0: 0.9 });
  assert.equal(spentOn(a.data.budget, 'd'), 0.001);
});

test('a 4xx answer is a known outcome: charged 0, still marked failed', async () => {
  const { a, ask } = setup(async () => { throw new HttpError(400); });
  await assert.rejects(ask({}), HttpError);
  assert.equal(spentOn(a.data.budget, 'd'), 0);
  assert.equal(a.data.budget.entries[0].status, 'failed');
});

test('401/403 become AuthError', async () => {
  const { ask } = setup(async () => { throw new HttpError(401); });
  await assert.rejects(ask({}), AuthError);
});

test('network errors and 5xx keep the reservation', async () => {
  const { a, ask } = setup(async () => { throw new HttpError(502); });
  await assert.rejects(ask({}), HttpError);
  assert.equal(spentOn(a.data.budget, 'd'), 0.02);
});

test('model mismatch is charged its reported cost', async () => {
  const { a, ask } = setup(async () => { throw new ModelMismatch('x', 0.0005); });
  await assert.rejects(ask({}), ModelMismatch);
  assert.equal(spentOn(a.data.budget, 'd'), 0.0005);
  assert.equal(a.data.budget.entries[0].status, 'failed');
});

test('an invalid answer whose cost came back is charged that cost, not the reserve', async () => {
  const { a, ask } = setup(async () => { throw Object.assign(new Error('invalid_response:c0'), { cost: 0.0004 }); });
  await assert.rejects(ask({}), /invalid_response/);
  assert.equal(spentOn(a.data.budget, 'd'), 0.0004);
  assert.equal(heldOn(a.data.budget, 'd'), 0);
});
