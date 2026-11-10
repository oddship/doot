import { expect, it, vi } from "vitest";
import { replaceClientUrl } from "@/lib/client-navigation";

vi.mock("@/lib/client-app-state", () => ({ flushAppStateWrites: vi.fn().mockResolvedValue(undefined) }));
it("retains reader ownership and framework metadata when replacing only URL parameters", () => {
  const prior = { state: history.state, url: location.pathname + location.search };
  const state = { __NA: true, dootInboxReader: true, retained: { key: "value" } };
  try {
    history.replaceState(state, "", "/inbox?open=1");
    replaceClientUrl("/inbox?open=1&query=example");
    expect(history.state).toEqual(state);
    expect(new URLSearchParams(location.search).get("query")).toBe("example");
  } finally {
    history.replaceState(prior.state, "", prior.url);
  }
});
