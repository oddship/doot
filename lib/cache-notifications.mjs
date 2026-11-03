// Mailbox workers can finish many steps in one burst. Preserve the last receipt
// for each message while sending at most one invalidation per resource per tick.
export function createCacheBroadcaster(send, delay = 250) {
  const pending = new Map();
  let timer;
  const flush = () => {
    timer = undefined;
    const events = [...pending.values()];
    pending.clear();
    for (const event of events) send(event);
  };
  const broadcast = (event) => {
    if (event.type !== "cache.refresh") return send(event);
    const key = `${event.resource}:${event.account || ""}`;
    const previous = pending.get(key);
    let items;
    if (previous?.items || event.items) {
      const receipts = new Map();
      for (const item of [...(previous?.items || []), ...(event.items || [])])
        receipts.set(`${item.account}\u001f${item.source_folder}\u001f${item.uid}`, item);
      items = [...receipts.values()];
    }
    pending.set(key, { ...previous, ...event, ...(items ? { items } : {}) });
    if (!timer) {
      timer = setTimeout(flush, delay);
      timer.unref?.();
    }
  };
  broadcast.close = () => {
    clearTimeout(timer);
    pending.clear();
  };
  return broadcast;
}
