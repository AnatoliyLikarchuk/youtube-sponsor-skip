import { makeChunks, makeSubchunks } from './chunks.js';
import { buildRequests } from './prompt.js';
import { mergeDecisions, refineZones, applyRefinement } from './segments.js';
import { ModelMismatch, AuthError } from './jev.js';
import { BudgetExceeded } from './budget.js';

const isFatal = (e) => e instanceof ModelMismatch || e instanceof BudgetExceeded || e instanceof AuthError;

// After a fatal error no new task starts; tasks already in flight finish.
async function pool(tasks, n) {
  const results = tasks.map(() => ({ ok: false, error: new Error('skipped') }));
  let next = 0, stop = false;
  const worker = async () => {
    while (!stop && next < tasks.length) {
      const i = next++;
      try { results[i] = { ok: true, value: await tasks[i]() }; } catch (error) { results[i] = { ok: false, error }; if (isFatal(error)) stop = true; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return results;
}

function rethrowFatal(results) {
  const fatal = results.find((r) => !r.ok && isFatal(r.error));
  if (fatal) throw fatal.error;
}

export async function analyzeVideo({ lines, ask, threshold = 0.5, concurrency = 4 }) {
  let requests = 0;
  const counted = (payload) => { requests++; return ask(payload); };

  const chunks = makeChunks(lines);
  const first = await pool(buildRequests(chunks).map((r) => () => counted(r.payload)), concurrency);
  rethrowFatal(first);
  const probs = Object.assign({}, ...first.filter((r) => r.ok).map((r) => r.value));
  const rough = mergeDecisions(chunks, probs, { threshold });

  const refined = await pool(rough.map((seg) => async () => {
    const z = refineZones(seg);
    const subs = makeSubchunks(lines, [z.left, z.right]);
    const parts = [];
    for (const r of buildRequests(subs, { context: 3 })) parts.push(await counted(r.payload));
    return applyRefinement(seg, subs, Object.assign({}, ...parts), threshold);
  }), concurrency);
  rethrowFatal(refined);

  return {
    segments: refined.map((r, i) => (r.ok ? r.value : rough[i])).filter(Boolean),
    complete: first.every((r) => r.ok) && refined.every((r) => r.ok),
    requests,
  };
}
