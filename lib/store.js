export function createStore(area) {
  let chain = Promise.resolve();
  const get = async (key, fallback) => ((await area.get(key))[key] ?? fallback);
  function mutate(key, fallback, fn) {
    const run = chain.then(async () => {
      const next = fn(await get(key, fallback));
      await area.set({ [key]: next });
      return next;
    });
    chain = run.catch(() => {});
    return run;
  }
  return { get, mutate };
}
