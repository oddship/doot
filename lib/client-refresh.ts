// Invalidation bursts share one read. If another update arrives during that
// read, perform one trailing read so the last saved outcome cannot be missed.
export function createRefreshQueue(load: () => Promise<unknown>) {
  let running: Promise<void> | undefined;
  let requested = false;
  return () => {
    requested = true;
    if (!running)
      running = Promise.resolve()
        .then(async () => {
          while (requested) {
            requested = false;
            await load();
          }
        })
        .catch(() => {
          /* The load function owns its user-visible error state. */
        })
        .finally(() => {
          running = undefined;
        });
    return running;
  };
}
