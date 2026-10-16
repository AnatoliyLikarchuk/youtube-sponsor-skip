export const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
export const MODEL = 'typesafe/jev-1.13';
export const EXPECTED_MODEL = 'typesafe/jev-1.13-20260917';
const CHOICES = ['sponsor', 'content'];

export class HttpError extends Error {
  constructor(status, detail = '') { super('http_' + status + (detail ? ': ' + detail : '')); this.status = status; }
}

// The server's own explanation (error.message), so the ledger says why a request was refused, not just the code.
async function errorDetail(res) {
  try {
    const text = await res.text();
    try { return String(JSON.parse(text).error.message).slice(0, 150); } catch { return text.slice(0, 150); }
  } catch { return ''; }
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

const KEY_ENDPOINT = 'https://openrouter.ai/api/v1/key';

// Lifetime spend of the key in USD (free request); null when it cannot be read.
export async function fetchKeyUsage(key, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(KEY_ENDPOINT, { signal: ctrl.signal, headers: { Authorization: 'Bearer ' + key } });
    if (!res.ok) return null;
    const u = (await res.json())?.data?.usage;
    return Number.isFinite(u) && u >= 0 ? u : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

export async function callJev(payload, { key, fetchImpl = globalThis.fetch, timeoutMs = 60000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST', signal: ctrl.signal, body: JSON.stringify(payload),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new HttpError(res.status, await errorDetail(res));
    const data = await res.json();
    const c = data.usage && data.usage.cost;
    const cost = Number.isFinite(c) && c >= 0 ? c : null;
    if (data.model !== EXPECTED_MODEL) throw new ModelMismatch(data.model, cost);
    let probs;
    try { probs = validateAnswers(data, payload.questions); } catch (e) { e.cost = cost; throw e; }
    return { probs, cost, model: data.model };
  } finally {
    clearTimeout(timer);
  }
}
