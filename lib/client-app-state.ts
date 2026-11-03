type Edit = { value: any; revision: number };
const values: Record<string, any> = {};
let initialized = false;
let draining: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 1000;
let writeVersion = 0;
let clientId: string | undefined;
const revisions = new Map<string, number>();
const freshness = new Map<string, number>();
const rejected = new Set<string>();
const rejectionNotified = new Set<string>();
const failures = new Map<string, Error>();
const pending = new Map<string, Edit>();
const inflight = new Map<string, number>();
const saves = new Set<Promise<void>>();
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
function retryFailed() {
  for (const key of failures.keys())
    if (!pending.has(key) && !inflight.has(key))
      pending.set(key, { value: values[key], revision: revisions.get(key)! });
}
function scheduleRetry() {
  if (retryTimer !== undefined) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    retryFailed();
    void drain();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30000);
}
function save(key: string, edit: Edit) {
  inflight.set(key, (inflight.get(key) || 0) + 1);
  clientId ||= crypto.randomUUID();
  const body = JSON.stringify({
    key,
    value: edit.value,
    client_id: clientId,
    revision: edit.revision,
  });
  const task = (async () => {
    try {
      const response = await fetch("/api/app-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: new TextEncoder().encode(body).byteLength < 60000,
      });
      if (!response.ok) {
        const message = (await response.json()).error || "Could not save app state";
        if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
          if (revisions.get(key) === edit.revision) {
            failures.delete(key);
            rejected.add(key);
            if (!rejectionNotified.has(key))
              window.dispatchEvent(
                new CustomEvent("doot-state-error", {
                  detail: `${message}. This edit could not be saved; its local value is kept on this page.`,
                }),
              );
            rejectionNotified.add(key);
          }
          return;
        }
        throw new Error(message);
      }
      if (revisions.get(key) === edit.revision) freshness.set(key, ++writeVersion);
      if (revisions.get(key) === edit.revision) {
        failures.delete(key);
        rejectionNotified.delete(key);
      }
      if (!failures.size) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
        retryDelay = 1000;
      }
    } catch (error) {
      if (revisions.get(key) !== edit.revision) return;
      const alreadyFailed = failures.has(key);
      failures.set(key, error as Error);
      scheduleRetry();
      if (!alreadyFailed && !pending.has(key))
        window.dispatchEvent(
          new CustomEvent("doot-state-error", {
            detail: `${(error as Error).message}. Retrying automatically; your edits are kept on this page.`,
          }),
        );
    } finally {
      const count = (inflight.get(key) || 1) - 1;
      if (count) inflight.set(key, count);
      else inflight.delete(key);
    }
  })();
  saves.add(task);
  void task.finally(() => saves.delete(task));
  return task;
}
async function drain() {
  if (draining) return draining;
  draining = (async () => {
    while (pending.size) {
      const [key, edit] = pending.entries().next().value!;
      pending.delete(key);
      await save(key, edit);
    }
  })().finally(() => {
    draining = undefined;
  });
  return draining;
}
export function writeAppState(key: string, value: any) {
  values[key] = value;
  revisions.set(key, ++writeVersion);
  freshness.set(key, writeVersion);
  rejected.delete(key);
  if (!initialized) {
    if (typeof window !== "undefined") localStorage.setItem(key, JSON.stringify(value));
    return;
  }
  pending.set(key, { value, revision: writeVersion });
  clearTimeout(timer);
  timer = setTimeout(() => {
    void drain();
  }, 180);
}
export async function flushAppStateWrites({ notify = true }: { notify?: boolean } = {}) {
  clearTimeout(timer);
  retryFailed();
  await drain();
  await Promise.all([...saves]);
  if (pending.size) await drain();
  if (failures.size) {
    const error = failures.values().next().value!;
    if (notify)
      window.dispatchEvent(
        new CustomEvent("doot-state-error", {
          detail: `Changes are not saved yet: ${error.message}. Retrying automatically.`,
        }),
      );
    throw error;
  }
}
export function flushAppStateOnPageHide() {
  clearTimeout(timer);
  retryFailed();
  const edits = [...pending];
  pending.clear();
  // Start every keepalive request synchronously, before the page is discarded.
  // Per-document revisions also prevent an older in-flight request winning later.
  for (const [key, edit] of edits) void save(key, edit);
}
export function appStateRevision() {
  return writeVersion;
}
export function refreshAppState(state: Record<string, unknown>, readVersion = writeVersion) {
  let changed = false;
  for (const [key, value] of Object.entries(state)) {
    if (
      hasPendingAppStateWrite(key) ||
      (freshness.get(key) || 0) > readVersion ||
      JSON.stringify(values[key]) === JSON.stringify(value)
    )
      continue;
    values[key] = value;
    changed = true;
  }
  if (changed) window.dispatchEvent(new Event("storage"));
}
export function hasPendingAppStateWrite(key: string) {
  return pending.has(key) || inflight.has(key) || failures.has(key) || rejected.has(key);
}
