export const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
export const MODEL = 'typesafe/jev-1.13';
export const EXPECTED_MODEL = 'typesafe/jev-1.13-20260917';
const CHOICES = ['sponsor', 'content'];

export class HttpError extends Error {
  constructor(status) { super('http_' + status); this.status = status; }
}
export class AuthError extends Error {
  constructor(status) { super('auth_' + status); this.status = status; }
}
export class ModelMismatch extends Error {
  constructor(model, cost) { super('model_mismatch:' + model); this.model = model; this.cost = cost; }
}

export function validateAnswers(data, questions) {
  const answers = data && data.answers;
  const probs = {};
  for (const id of Object.keys(questions)) {
    const a = answers && answers[id];
    const p = a && a.probabilities;
    const valid = a && a.type === 'choice' && CHOICES.includes(a.choice) && p
      && CHOICES.every((c) => Number.isFinite(p[c]) && p[c] >= 0 && p[c] <= 1)
      && Math.abs(p.sponsor + p.content - 1) < 0.04;
    if (!valid) throw new Error('invalid_response:' + id);
    probs[id] = p.sponsor;
  }
  return probs;
}

export async function callJev(payload, { key, fetchImpl = globalThis.fetch, timeoutMs = 60000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST', signal: ctrl.signal, body: JSON.stringify(payload),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new HttpError(res.status);
    const data = await res.json();
    const c = data.usage && data.usage.cost;
    const cost = Number.isFinite(c) && c >= 0 ? c : null;
    if (data.model !== EXPECTED_MODEL) throw new ModelMismatch(data.model, cost);
    return { probs: validateAnswers(data, payload.questions), cost, model: data.model };
  } finally {
    clearTimeout(timer);
  }
}
