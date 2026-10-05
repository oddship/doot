"use client";
import { useEffect, useRef } from "react";

// Keep the connection stable while handlers track the latest committed state.
export function useCacheEvents(handler: (value: any) => void) {
  const current = useRef(handler);
  useEffect(() => {
    current.current = handler;
  }, [handler]);
  useEffect(() => {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    let disposed = false;
    socket.onmessage = (event) => {
      if (disposed) return;
      let value: any;
      try {
        value = JSON.parse(event.data);
      } catch {
        return;
      }
      if (value && typeof value === "object") current.current(value);
    };
    return () => {
      disposed = true;
      socket.close();
    };
  }, []);
}
