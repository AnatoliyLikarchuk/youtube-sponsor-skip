import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequests } from '../lib/prompt.js';
import { callJev, validateAnswers, ModelMismatch, EXPECTED_MODEL, MODEL } from '../lib/jev.js';

const items = Array.from({ length: 70 }, (_, i) => ({ id: 'c' + String(i).padStart(3, '0'), start: i * 20, end: i * 20 + 20, text: `t${i}` }));

test('buildRequests splits into ≤30 questions with ±context transcript', () => {
  const reqs = buildRequests(items, { context: 5 });
  assert.deepEqual(reqs.map((r) => r.ids.length), [30, 30, 10]);
  assert.equal(reqs[1].ids[0], 'c030');
  const lines = reqs[1].payload.state.transcript.split('\n');
  assert.equal(lines.length, 40);
  assert.equal(lines[0], '[c025 8:20-8:40] t25');
  assert.equal(reqs[0].payload.model, MODEL);
  const q = reqs[0].payload.questions.c007;
  assert.equal(q.type, 'choice');
  assert.deepEqual(Object.keys(q.criteria), ['sponsor', 'content']);
  assert.match(q.instructions, /chunk c007/);
});

const answer = (p) => ({ type: 'choice', choice: p >= 0.5 ? 'sponsor' : 'content', probabilities: { sponsor: p, content: 1 - p }, confidence: 0.9 });
const questions = { c000: {}, c001: {} };
const ok = { model: EXPECTED_MODEL, answers: { c000: answer(0.9), c001: answer(0.1) }, usage: { cost: 0.0007 } };
const fakeFetch = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });

test('validateAnswers returns p(sponsor) per question', () => {
  assert.deepEqual(validateAnswers(ok, questions), { c000: 0.9, c001: 0.1 });
});

test('validateAnswers rejects missing keys and unknown choices', () => {
  assert.throws(() => validateAnswers({ answers: { c000: answer(0.9) } }, questions), /invalid_response/);
  const bad = { answers: { c000: answer(0.9), c001: { ...answer(0.1), choice: 'maybe' } } };
  assert.throws(() => validateAnswers(bad, questions), /invalid_response:c001/);
});

test('callJev returns probs and cost, sends bearer key', async () => {
  let seen;
  const res = await callJev({ questions }, { key: 'sk-or-x', fetchImpl: async (url, init) => { seen = init; return fakeFetch(200, ok)(); } });
  assert.deepEqual(res, { probs: { c000: 0.9, c001: 0.1 }, cost: 0.0007, model: EXPECTED_MODEL });
  assert.equal(seen.headers.Authorization, 'Bearer sk-or-x');
});

test('callJev throws on HTTP error and on model mismatch with cost', async () => {
  await assert.rejects(callJev({ questions }, { key: 'k', fetchImpl: fakeFetch(429, {}) }), /http_429/);
  const other = { ...ok, model: 'typesafe/jev-1.14-20261101' };
  await assert.rejects(callJev({ questions }, { key: 'k', fetchImpl: fakeFetch(200, other) }),
    (e) => e instanceof ModelMismatch && e.cost === 0.0007 && e.model === other.model);
});
