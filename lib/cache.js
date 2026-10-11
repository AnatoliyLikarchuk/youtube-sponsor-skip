export function getEntry(cache, videoId, version) {
  const e = cache[videoId];
  return e && e.version === version ? e : null;
}

export function putEntry(cache, videoId, entry, version, max = 500, now = Date.now()) {
  const next = { ...cache, [videoId]: { ...entry, version, savedAt: now } };
  const ids = Object.keys(next).sort((a, b) => next[a].savedAt - next[b].savedAt);
  for (const id of ids.slice(0, Math.max(0, ids.length - max))) delete next[id];
  return next;
}
