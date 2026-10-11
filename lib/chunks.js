export const CHUNK_MS = 20000;

export function makeChunks(lines, chunkMs = CHUNK_MS) {
  const buckets = new Map();
  for (const l of lines) {
    const k = Math.floor(l.startMs / chunkMs);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(l.text);
  }
  return [...buckets.keys()].sort((a, b) => a - b).map((k) => ({
    id: 'c' + String(k).padStart(3, '0'), start: (k * chunkMs) / 1000, end: ((k + 1) * chunkMs) / 1000, text: buckets.get(k).join(' '),
  }));
}

export function makeSubchunks(lines, zones) {
  const out = [];
  lines.forEach((l, i) => {
    const t = l.startMs / 1000;
    if (!zones.some(([from, to]) => t >= from && t < to)) return;
    const next = lines[i + 1];
    out.push({ id: 's' + String(i).padStart(4, '0'), start: t, end: (next ? next.startMs : l.endMs) / 1000, text: l.text });
  });
  return out;
}
