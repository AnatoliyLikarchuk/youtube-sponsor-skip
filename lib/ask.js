import { callJev, ModelMismatch, HttpError, AuthError } from './jev.js';
import { reserve, settle, markFailed, today } from './budget.js';

// Budget-guarded Jev call: reserve before sending; a 4xx answer is a known outcome (charged 0), a mismatch or invalid
// answer costs what it reported, anything else (network, timeout, 5xx, invalid body) keeps the reservation.
export function makeAsk({ store, key, limitUsd, call = callJev, newId = () => crypto.randomUUID(), day = today }) {
  const mutate = (fn) => store.mutate('budget', { entries: [] }, fn);
  return async (payload) => {
    const id = newId();
    await mutate((l) => reserve(l, { id, day: day(), limitUsd }));
    try {
      const { probs, cost } = await call(payload, { key });
      await mutate((l) => settle(l, id, cost));
      return probs;
    } catch (e) {
      await mutate((l) => {
        const failed = markFailed(l, id, String(e.message || e));
        if (e instanceof ModelMismatch || Number.isFinite(e.cost)) return settle(failed, id, e.cost);
        if (e instanceof HttpError && e.status >= 400 && e.status < 500) return settle(failed, id, 0);
        return failed;
      });
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw new AuthError(e.status);
      throw e;
    }
  };
}
