import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDecisions, refineZones, applyRefinement } from '../lib/segments.js';

const items = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, start: i * 20, end: i * 20 + 20 }));

test('mergeDecisions bridges one non-sponsor chunk', () => {
  assert.deepEqual(mergeDecisions(items, { c1: 0.9, c2: 0.2, c3: 0.8 }), [{ start: 20, end: 80 }]);
});

test('mergeDecisions keeps segments apart across two gap chunks', () => {
  assert.deepEqual(mergeDecisions(items, { c0: 0.9, c3: 0.9 }), [{ start: 0, end: 20 }, { start: 60, end: 80 }]);
});

test('mergeDecisions uses threshold inclusively and treats missing ids as content', () => {
  assert.deepEqual(mergeDecisions(items, { c4: 0.5 }), [{ start: 80, end: 100 }]);
  assert.deepEqual(mergeDecisions(items, { c4: 0.49 }), []);
  assert.deepEqual(mergeDecisions(items, {}, { threshold: 0.7 }), []);
});

test('refineZones clamps at zero', () => {
  assert.deepEqual(refineZones({ start: 0, end: 20 }), { left: [0, 20], right: [0, 40] });
  assert.deepEqual(refineZones({ start: 460, end: 540 }), { left: [440, 480], right: [520, 560] });
});

const subs = Array.from({ length: 24 }, (_, i) => ({ id: `s${i}`, start: 440 + i * 5, end: 445 + i * 5 }));
const adProbs = Object.fromEntries(subs.map((s) => [s.id, s.start >= 475 && s.start < 540 ? 0.9 : 0.05]));

test('applyRefinement moves both edges to the first and last sponsor subchunk', () => {
  assert.deepEqual(applyRefinement({ start: 460, end: 540 }, subs, adProbs), { start: 475, end: 540 });
});

test('applyRefinement without sponsor subchunks shrinks inward and can drop the segment', () => {
  const none = Object.fromEntries(subs.map((s) => [s.id, 0]));
  assert.deepEqual(applyRefinement({ start: 460, end: 540 }, subs, none), { start: 480, end: 520 });
  assert.equal(applyRefinement({ start: 460, end: 480 }, subs, none), null);
});
