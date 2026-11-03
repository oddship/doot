// One connection and one disconnected fallback timer per browser tab.
type Listener = (event: any) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | undefined;
let reconnect: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setInterval> | undefined;
let delay = 1000;
function publish(event: any) {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      /* One view must not interrupt other subscribers. */
    }
  }
}
function refresh() {
  if (document.visibilityState === "visible") publish({ type: "cache.refresh", resource: "all" });
}
function connect() {
  if (!listeners.size) return;
  const connection = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket = connection;
  connection.onopen = () => {
    delay = 1000;
  };
  connection.onmessage = (message) => {
    if (socket !== connection) return;
    try {
      const value = JSON.parse(message.data);
      if (value && typeof value === "object") publish(value);
    } catch {
      /* Ignore malformed frames. Persisted state is authoritative. */
    }
  };
  connection.onclose = () => {
    if (socket !== connection) return;
    socket = undefined;
    if (listeners.size) {
      reconnect = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30000);
    }
  };
  connection.onerror = () => connection.close();
}
export function subscribeCacheEvents(listener: Listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    connect();
    document.addEventListener("visibilitychange", refresh);
    poll = setInterval(() => {
      if (socket?.readyState !== 1) refresh();
    }, 10000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearTimeout(reconnect);
    clearInterval(poll);
    document.removeEventListener("visibilitychange", refresh);
    const previous = socket;
    socket = undefined;
    previous?.close();
    delay = 1000;
  };
}
export function cacheEventsConnected() {
  return socket?.readyState === 1;
}
