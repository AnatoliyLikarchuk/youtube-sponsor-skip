import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVideo } from '../lib/pipeline.js';
import { ModelMismatch } from '../lib/jev.js';
import { BudgetExceeded } from '../lib/budget.js';

// 30 lines of 5 s; lines 8..15 (40–80 s) are the ad read.
const lines = Array.from({ length: 30 }, (_, i) => ({
  startMs: i * 5000, endMs: i * 5000 + 5000, text: i >= 8 && i <= 15 ? `реклама промокод ${i}` : `обычный текст ${i}`,
}));

// Fake Jev: reads each question's own label from the transcript.
function fakeAsk(log = []) {
  return async (payload) => {
    log.push(Object.keys(payload.questions));
    const probs = {};
    for (const id of Object.keys(payload.questions)) {
      const m = payload.state.transcript.match(new RegExp(`\\[${id} [^\\]]*\\] (.*)`));
      probs[id] = m && m[1].includes('промокод') ? 0.9 : 0.05;
    }
    return probs;
  };
}

test('analyzeVideo finds and refines the ad segment', async () => {
  const log = [];
  const r = await analyzeVideo({ lines, ask: fakeAsk(log) });
  assert.deepEqual(r.segments, [{ start: 40, end: 80 }]);
  assert.equal(r.complete, true);
  assert.equal(r.requests, 2); // one first-pass request (8 chunks) + one refinement request
  assert.ok(log[1].every((id) => id.startsWith('s')));
});

test('a failed request marks the result incomplete and keeps the rest', async () => {
  let n = 0;
  const ask = fakeAsk();
  const r = await analyzeVideo({ lines, ask: (p) => (n++ === 1 ? Promise.reject(new Error('http_500')) : ask(p)) });
  assert.deepEqual(r.segments, [{ start: 40, end: 80 }]); // refinement failed → rough segment kept
  assert.equal(r.complete, false);
});

test('model mismatch and budget exhaustion are fatal', async () => {
  await assert.rejects(analyzeVideo({ lines, ask: () => Promise.reject(new ModelMismatch('x', 0)) }), ModelMismatch);
  await assert.rejects(analyzeVideo({ lines, ask: () => Promise.reject(new BudgetExceeded()) }), BudgetExceeded);
});

test('concurrency never exceeds the limit', async () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ startMs: i * 5000, endMs: i * 5000 + 5000, text: 'x' }));
  let inFlight = 0, peak = 0;
  await analyzeVideo({ lines: many, concurrency: 4, ask: async (p) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return Object.fromEntries(Object.keys(p.questions).map((id) => [id, 0]));
  } });
  assert.equal(peak, 4);
});

test('a fatal error stops new requests immediately', async () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ startMs: i * 5000, endMs: i * 5000 + 5000, text: 'x' }));
  let calls = 0;
  await assert.rejects(analyzeVideo({ lines: many, concurrency: 1, ask: async () => { calls++; throw new BudgetExceeded(); } }), BudgetExceeded);
  assert.equal(calls, 1);
});

test('AuthError is fatal', async () => {
  const { AuthError } = await import('../lib/jev.js');
  await assert.rejects(analyzeVideo({ lines, ask: () => Promise.reject(new AuthError(401)) }), AuthError);
});
