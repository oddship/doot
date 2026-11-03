const values: Record<string, any> = {};
let initialized = false;
let writes: Promise<void> = Promise.resolve();
const failures = new Map<string, Error>();
const pending = new Map<string, number>();
export function initializeAppState(state: Record<string, unknown>) {
  if (initialized) return;
  Object.assign(values, state);
  initialized = true;
}
export function readAppState(key: string, fallback: any = null) {
  if (initialized) return values[key] ?? fallback;
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) || sessionStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeAppState(key: string, value: any) {
  values[key] = value;
  if (!initialized) {
    if (typeof window !== "undefined") localStorage.setItem(key, JSON.stringify(value));
    return;
  }
  pending.set(key, (pending.get(key) || 0) + 1);
  writes = writes.then(async () => {
    try {
      const response = await fetch("/api/app-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
        keepalive: new TextEncoder().encode(JSON.stringify({ key, value })).byteLength < 60000,
      });
      if (!response.ok) throw new Error((await response.json()).error || "Could not save app state");
      failures.delete(key);
    } catch (error) {
      failures.set(key, error as Error);
      window.dispatchEvent(new CustomEvent("doot-state-error", { detail: String((error as Error).message) }));
    } finally {
      const count = (pending.get(key) || 1) - 1;
      if (count) pending.set(key, count);
      else pending.delete(key);
    }
  });
}
export async function flushAppStateWrites() {
  await writes;
  if (failures.size) throw failures.values().next().value;
}
export function refreshAppState(state: Record<string, unknown>) {
  for (const [key, value] of Object.entries(state)) if (!pending.has(key)) values[key] = value;
  window.dispatchEvent(new Event("storage"));
}

export function hasPendingAppStateWrite(key: string) {
  return pending.has(key) || failures.has(key);
}
