import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkipper, acceptResult } from '../lib/skipper.js';

test('skips a segment once, including one that starts at 0', () => {
  const s = createSkipper([{ start: 0, end: 20 }, { start: 100, end: 160 }]);
  assert.deepEqual(s.onTime(0, 600).to, 20);
  assert.equal(s.onTime(5, 600), null);
  assert.equal(s.onTime(50, 600), null);
  assert.equal(s.onTime(101, 600).to, 160);
});

test('a user seek into a segment disables the skip for it', () => {
  const s = createSkipper([{ start: 100, end: 160 }]);
  s.onSeek(120);
  assert.equal(s.onTime(121), null);
});

test('undo returns the segment start and never skips it again', () => {
  const s = createSkipper([{ start: 100, end: 160 }]);
  const { seg } = s.onTime(100, 600);
  assert.equal(s.undo(seg), 100);
  assert.equal(s.onTime(100.5), null);
});

test('never seeks past the end of the video', () => {
  const s = createSkipper([{ start: 580, end: 640 }]);
  assert.equal(s.onTime(590, 600).to, 599.9);
});

test('duration is read at skip time, not when the skipper was created (YouTube pre-roll shares the video element)', () => {
  const s = createSkipper([{ start: 300, end: 360 }]);
  assert.equal(s.onTime(300, 3600).to, 360);
});

test('never seeks backwards and keeps the segment armed when there is nothing to skip', () => {
  const s = createSkipper([{ start: 580, end: 640 }]);
  assert.equal(s.onTime(599.95, 600), null);
  assert.equal(s.onTime(585, 600).to, 599.9);
});

test('ignores the last half second of a segment and unknown duration', () => {
  const s = createSkipper([{ start: 10, end: 30 }]);
  assert.equal(s.onTime(29.6), null);
  assert.equal(s.onTime(12).to, 30);
});

test('acceptResult drops answers for a video the user already left', () => {
  assert.equal(acceptResult('B', { videoId: 'A', segments: [] }), false);
  assert.equal(acceptResult('A', { videoId: 'A', segments: [] }), true);
  assert.equal(acceptResult('A', undefined), false);
});
