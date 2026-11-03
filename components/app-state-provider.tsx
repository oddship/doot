"use client";
import { useRouter } from "next/navigation";
import { Fragment, type ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import { useToast } from "@/components/feedback";
import { appStateRevision, flushAppStateOnPageHide, initializeAppState, refreshAppState } from "@/lib/client-app-state";
import { CLIENT_NAVIGATION_EVENT } from "@/lib/client-navigation";
import { createRefreshQueue } from "@/lib/client-refresh";
import { useCacheEvents } from "@/lib/use-cache-events";
export function AppStateProvider({
  state,
  children,
  header,
}: {
  state: Record<string, unknown>;
  children: ReactNode;
  header?: ReactNode;
}) {
  initializeAppState(state);
  const toast = useToast();
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [pageVersion, setPageVersion] = useState(0);
  const refresh = useMemo(
    () =>
      createRefreshQueue(() => {
        const revision = appStateRevision();
        return fetch("/api/app-state", { cache: "no-store" })
          .then((response) => (response.ok ? response.json() : null))
          .then((value) => {
            if (value) refreshAppState(value.state, revision);
          })
          .catch(() => {});
      }),
    [],
  );
  useCacheEvents((event) => {
    if (event.type === "cache.refresh" && ["all", "app-state"].includes(event.resource)) void refresh();
  });
  useEffect(() => {
    const error = (event: Event) => toast.error("Could not save app state", (event as CustomEvent).detail);
    const navigate = (event: Event) => {
      const { path, replace } = (event as CustomEvent).detail;
      if (replace || !path.startsWith("/") || path.startsWith("//")) return;
      event.preventDefault();
      startNavigation(() => {
        // History.replaceState updates Inbox URLs without a server navigation.
        // Reset its local state even if Next reuses the original route payload.
        const target = new URL(path, location.origin);
        if (target.href === location.href) return;
        if (target.pathname === location.pathname) setPageVersion((value) => value + 1);
        router.push(path);
      });
    };
    const flush = () => {
      flushAppStateOnPageHide();
    };
    window.addEventListener("doot-state-error", error);
    window.addEventListener(CLIENT_NAVIGATION_EVENT, navigate);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("doot-state-error", error);
      window.removeEventListener(CLIENT_NAVIGATION_EVENT, navigate);
      window.removeEventListener("pagehide", flush);
    };
  }, [toast, router]);
  return (
    <>
      {navigating && <div className="navigation-progress" role="progressbar" aria-label="Loading page" />}
      {header}
      <Fragment key={pageVersion}>{children}</Fragment>
    </>
  );
}
