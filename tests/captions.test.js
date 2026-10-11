import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJson3, pickRussianTrack } from '../lib/captions.js';
import { makeChunks, makeSubchunks } from '../lib/chunks.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/synthetic.ru.json3', import.meta.url)));

test('parseJson3 keeps timed, non-empty lines without newlines', () => {
  const lines = parseJson3(fixture);
  assert.ok(lines.length > 200);
  assert.deepEqual(lines[0], { startMs: 80, endMs: 4080, text: 'Всем привет, это тестовые субтитры.' });
  assert.ok(lines.every((l) => l.text && !l.text.includes('\n') && l.endMs >= l.startMs));
});

test('parseJson3 tolerates missing events', () => {
  assert.deepEqual(parseJson3({}), []);
});

test('pickRussianTrack prefers manual Russian, then ASR, never other languages', () => {
  const en = { languageCode: 'en', kind: 'asr' };
  const ruAsr = { languageCode: 'ru', kind: 'asr' };
  const ruManual = { languageCode: 'ru-RU' };
  assert.equal(pickRussianTrack([en, ruAsr, ruManual]), ruManual);
  assert.equal(pickRussianTrack([en, ruAsr]), ruAsr);
  assert.equal(pickRussianTrack([en, { languageCode: 'uk' }]), null);
  assert.equal(pickRussianTrack(undefined), null);
});

const lines = Array.from({ length: 12 }, (_, i) => ({ startMs: i * 5000, endMs: i * 5000 + 5000, text: `l${i}` }));

test('makeChunks groups lines into 20 s buckets with stable ids', () => {
  const chunks = makeChunks(lines);
  assert.deepEqual(chunks.map((c) => [c.id, c.start, c.end, c.text]), [
    ['c000', 0, 20, 'l0 l1 l2 l3'], ['c001', 20, 40, 'l4 l5 l6 l7'], ['c002', 40, 60, 'l8 l9 l10 l11'],
  ]);
});

test('makeChunks skips empty buckets', () => {
  const chunks = makeChunks([{ startMs: 0, endMs: 1000, text: 'a' }, { startMs: 65000, endMs: 66000, text: 'b' }]);
  assert.deepEqual(chunks.map((c) => c.id), ['c000', 'c003']);
});

test('makeSubchunks returns lines inside zones once, ending at the next line start', () => {
  const subs = makeSubchunks(lines, [[10, 25], [20, 30]]);
  assert.deepEqual(subs.map((s) => [s.id, s.start, s.end]), [
    ['s0002', 10, 15], ['s0003', 15, 20], ['s0004', 20, 25], ['s0005', 25, 30],
  ]);
});
