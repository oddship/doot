import { flushAppStateWrites } from "@/lib/client-app-state";
export const CLIENT_NAVIGATION_EVENT = "doot-client-navigation";

function navigationEvent(path: string, replace: boolean) {
  return new CustomEvent(CLIENT_NAVIGATION_EVENT, {
    cancelable: true,
    detail: { path, replace },
  });
}

export function navigateClient(path: string) {
  if (typeof window === "undefined") return;
  void flushAppStateWrites()
    .then(() => {
      if (!window.dispatchEvent(navigationEvent(path, false))) return;
      window.location.href = path;
    })
    .catch(() => {});
}

export function replaceClientUrl(path: string) {
  if (typeof window === "undefined") return;
  if (!window.dispatchEvent(navigationEvent(path, true))) return;
  window.history.replaceState(null, "", path);
}
