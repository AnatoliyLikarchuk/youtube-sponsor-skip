export function mergeDecisions(items, probs, { threshold = 0.5, bridgeSec = 20 } = {}) {
  const segs = [];
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    if ((probs[it.id] ?? 0) < threshold) continue;
    const last = segs[segs.length - 1];
    if (last && it.start - last.end <= bridgeSec) last.end = Math.max(last.end, it.end);
    else segs.push({ start: it.start, end: it.end });
  }
  return segs;
}

export function refineZones(seg, width = 20) {
  return {
    left: [Math.max(0, seg.start - width), seg.start + width],
    right: [Math.max(0, seg.end - width), seg.end + width],
  };
}

export function applyRefinement(seg, subs, probs, threshold = 0.5, width = 20) {
  const z = refineZones(seg, width);
  const isAd = (s) => (probs[s.id] ?? 0) >= threshold;
  const within = ([from, to]) => subs.filter((s) => s.start >= from && s.start < to);
  const first = within(z.left).find(isAd);
  const last = within(z.right).reverse().find(isAd);
  const start = first ? first.start : Math.min(z.left[1], seg.end);
  const end = last ? last.end : Math.max(z.right[0], start);
  return end - start >= 3 ? { start, end } : null;
}
