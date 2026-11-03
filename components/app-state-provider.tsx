"use client";
import { type ReactNode, useEffect } from "react";
import { useToast } from "@/components/feedback";
import { initializeAppState, refreshAppState } from "@/lib/client-app-state";
export function AppStateProvider({ state, children }: { state: Record<string, unknown>; children: ReactNode }) {
  initializeAppState(state);
  const toast = useToast();
  useEffect(() => {
    const error = (event: Event) => toast.error("Could not save app state", (event as CustomEvent).detail);
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/app-state", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((value) => {
          if (value) refreshAppState(value.state);
        })
        .catch(() => {});
    };
    window.addEventListener("doot-state-error", error);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener("doot-state-error", error);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [toast]);
  return children;
}
