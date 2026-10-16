export const RESERVE_USD = 0.02;
export class BudgetExceeded extends Error { constructor() { super('budget_exceeded'); } }

const round = (x) => Math.round(x * 1e9) / 1e9;
export const today = (date = new Date()) => date.toLocaleDateString('sv-SE');
export const spentOn = (ledger, day) => round(ledger.entries.filter((e) => e.day === day).reduce((s, e) => s + e.chargedUsd, 0));
export function spentByDay(ledger) {
  const out = {};
  for (const e of ledger.entries) out[e.day] = round((out[e.day] || 0) + e.chargedUsd);
  return out;
}

// Short non-reversible label of the API key an entry was sent with (FNV-1a), so reconciliation counts only that key.
export function keyTag(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function reserve(ledger, { id, day, limitUsd, keyTag: tag, at }) {
  if (spentOn(ledger, day) + RESERVE_USD > limitUsd + 1e-9) throw new BudgetExceeded();
  const meta = { ...(tag ? { keyTag: tag } : {}), ...(Number.isFinite(at) ? { at } : {}) };
  return { entries: [...ledger.entries, { id, day, status: 'reserved', chargedUsd: RESERVE_USD, ...meta }] };
}

const update = (ledger, id, fn) => ({ entries: ledger.entries.map((e) => (e.id === id ? fn(e) : e)) });
export const settle = (ledger, id, costUsd) => update(ledger, id, (e) =>
  (Number.isFinite(costUsd) && costUsd >= 0 ? { ...e, status: e.status === 'failed' ? 'failed' : 'settled', chargedUsd: costUsd, known: true } : e));
// Reservations whose real cost never came back (in flight, or the connection dropped). They still count toward the
// limit; the popup shows them apart. Entries from before `known` existed: a failed one still at the reserve is unconfirmed.
const unconfirmed = (e) => !e.known && (e.status === 'reserved' || (e.status === 'failed' && e.chargedUsd === RESERVE_USD));
export const heldOn = (ledger, day) => round(ledger.entries.filter((e) => e.day === day && unconfirmed(e)).reduce((s, e) => s + e.chargedUsd, 0));
// Lost reservations (cost never came back) are lowered to what the key's lifetime usage on OpenRouter leaves unexplained
// after the known costs of the same key, oldest first. Total charged for the key never drops below its usage, so the
// ledger stays pessimistic; with a key shared with other tools the unexplained part is large and nothing is released.
// Skipped while any loss or request in flight is younger than minAgeMs (usage may lag; requests time out after 60 s,
// so an older 'reserved' entry is a request whose worker died).
export function reconcile(ledger, { keyTag: tag, usageUsd, now, minAgeMs = 60_000 }) {
  if (!Number.isFinite(usageUsd)) return ledger;
  const mine = ledger.entries.filter((e) => e.keyTag === tag);
  const lost = mine.filter(unconfirmed);
  if (!lost.length || lost.some((e) => !(now - e.at >= minAgeMs))) return ledger;
  let left = round(usageUsd - mine.filter((e) => !unconfirmed(e)).reduce((s, e) => s + e.chargedUsd, 0));
  const charge = new Map(lost.map((e) => { const c = round(Math.max(0, Math.min(e.chargedUsd, left))); left = round(left - c); return [e.id, c]; }));
  return { entries: ledger.entries.map((e) => (charge.has(e.id) ? { ...e, chargedUsd: charge.get(e.id), known: true, reconciled: true } : e)) };
}
export const markFailed = (ledger, id, error) => update(ledger, id, (e) => ({ ...e, status: 'failed', error: error.slice(0, 200) }));
