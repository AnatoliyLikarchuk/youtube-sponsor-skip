export function once(map, key, fn) {
  if (!map.has(key)) map.set(key, fn().finally(() => map.delete(key)));
  return map.get(key);
}
