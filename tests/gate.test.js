import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gate } from '../lib/gate.js';
import { once } from '../lib/once.js';
import { DEFAULT_SETTINGS } from '../lib/settings.js';

const s = { ...DEFAULT_SETTINGS, key: 'sk-or-x' };

test('gate decides before captions are touched', () => {
  assert.deepEqual(gate({ ...s, disabledReason: 'x' }, null, 0), { need: false, status: 'disabled', segments: [] });
  assert.deepEqual(gate({ ...s, key: '' }, null, 0), { need: false, status: 'no_key', segments: [] });
  assert.deepEqual(gate(s, { segments: [{ start: 1, end: 9 }] }, 0), { need: false, status: 'cached', segments: [{ start: 1, end: 9 }] });
  assert.deepEqual(gate(s, null, 0.19), { need: false, status: 'budget', segments: [] });
  assert.deepEqual(gate(s, null, 0.18), { need: true });
});

test('once shares one in-flight run per key and forgets it afterwards', async () => {
  const map = new Map();
  let runs = 0;
  const fn = () => new Promise((r) => setTimeout(() => r(++runs), 5));
  const [a, b] = await Promise.all([once(map, 'v', fn), once(map, 'v', fn)]);
  assert.deepEqual([a, b, runs], [1, 1, 1]);
  assert.equal(await once(map, 'v', fn), 2);
});

test('pause stops new paid analyses but keeps free cached skips', () => {
  const paused = { ...s, paused: true };
  assert.deepEqual(gate(paused, null, 0), { need: false, status: 'paused', segments: [] });
  assert.deepEqual(gate(paused, { segments: [{ start: 1, end: 9 }] }, 0), { need: false, status: 'cached', segments: [{ start: 1, end: 9 }] });
});
