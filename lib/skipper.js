// duration is passed per call: YouTube plays its own ads in the same <video>, so a value captured earlier can be an ad's.
export function createSkipper(segments) {
  const segs = segments.map((s, i) => ({ ...s, i }));
  const done = new Set();
  const inside = (t) => segs.find((s) => t >= s.start && t < s.end - 0.5);
  return {
    onSeek(t) { const s = inside(t); if (s) done.add(s.i); },
    onTime(t, duration = Infinity) {
      const s = inside(t);
      if (!s || done.has(s.i)) return null;
      const to = Math.round((Number.isFinite(duration) && duration > 0 ? Math.min(s.end, duration - 0.1) : s.end) * 1000) / 1000;
      if (to <= t) return null;
      done.add(s.i);
      return { seg: s, to };
    },
    undo(seg) { done.add(seg.i); return seg.start; },
  };
}

export function acceptResult(currentVideoId, result) {
  return !!result && result.videoId === currentVideoId && Array.isArray(result.segments);
}
