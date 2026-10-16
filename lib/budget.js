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

export function reserve(ledger, { id, day, limitUsd }) {
  if (spentOn(ledger, day) + RESERVE_USD > limitUsd + 1e-9) throw new BudgetExceeded();
  return { entries: [...ledger.entries, { id, day, status: 'reserved', chargedUsd: RESERVE_USD }] };
}

const update = (ledger, id, fn) => ({ entries: ledger.entries.map((e) => (e.id === id ? fn(e) : e)) });
export const settle = (ledger, id, costUsd) => update(ledger, id, (e) =>
  (Number.isFinite(costUsd) && costUsd >= 0 ? { ...e, status: e.status === 'failed' ? 'failed' : 'settled', chargedUsd: costUsd, known: true } : e));
// Reservations whose real cost never came back (in flight, or the connection dropped). They still count toward the
// limit; the popup shows them apart. Entries from before `known` existed: a failed one still at the reserve is unconfirmed.
const unconfirmed = (e) => !e.known && (e.status === 'reserved' || (e.status === 'failed' && e.chargedUsd === RESERVE_USD));
export const heldOn = (ledger, day) => round(ledger.entries.filter((e) => e.day === day && unconfirmed(e)).reduce((s, e) => s + e.chargedUsd, 0));
export const markFailed = (ledger, id, error) => update(ledger, id, (e) => ({ ...e, status: 'failed', error: error.slice(0, 200) }));
