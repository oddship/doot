"use client";
import { useEffect, useRef } from "react";
import { subscribeCacheEvents } from "@/lib/cache-events";

// Handlers track current state without reconnecting or owning their own poller.
export function useCacheEvents(handler: (value: any) => void) {
  const current = useRef(handler);
  useEffect(() => {
    current.current = handler;
  }, [handler]);
  useEffect(() => subscribeCacheEvents((event) => current.current(event)), []);
}
