export function parseJson3(obj) {
  const out = [];
  for (const e of (obj && obj.events) || []) {
    if (!e.segs) continue;
    const text = e.segs.map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push({ startMs: e.tStartMs, endMs: e.tStartMs + (e.dDurationMs || 0), text });
  }
  return out;
}

// Keep in sync with the copy in page-hook.js (page scripts cannot import modules).
export function pickRussianTrack(tracks) {
  const ru = (tracks || []).filter((t) => (t.languageCode || '').split('-')[0] === 'ru');
  return ru.find((t) => t.kind !== 'asr') || ru.find((t) => t.kind === 'asr') || null;
}
