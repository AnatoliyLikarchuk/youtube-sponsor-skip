import { RESERVE_USD } from './budget.js';

// Decides whether a video needs captions and a paid analysis, before the page touches the caption track.
export function gate(settings, cacheHit, spentToday) {
  const no = (status, segments = []) => ({ need: false, status, segments });
  if (settings.disabledReason) return no('disabled');
  if (!settings.key) return no('no_key');
  if (cacheHit) return no('cached', cacheHit.segments);
  if (settings.paused) return no('paused');
  if (spentToday + RESERVE_USD > settings.dailyLimitUsd + 1e-9) return no('budget');
  return { need: true };
}
