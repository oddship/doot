"use client";
import { useEffect, useRef } from "react";

// Notifications only invalidate views. Execution and progress live in SQLite.
export function useCacheEvents(handler: (value: any) => void) {
  const current = useRef(handler);
  useEffect(() => {
    current.current = handler;
  }, [handler]);
  useEffect(() => {
    let socket: WebSocket | undefined;
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (!disposed && document.visibilityState === "visible")
        current.current({ type: "cache.refresh", resource: "all" });
    };
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      socket.onopen = refresh;
      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const value = JSON.parse(event.data);
          if (value && typeof value === "object") current.current(value);
        } catch {}
      };
      socket.onclose = () => {
        if (!disposed) reconnect = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    const poll = setInterval(refresh, 10000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearInterval(poll);
      clearTimeout(reconnect);
      document.removeEventListener("visibilitychange", refresh);
      socket?.close();
    };
  }, []);
}
