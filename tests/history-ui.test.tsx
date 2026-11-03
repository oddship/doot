import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { HistoryDetailView } from "@/components/history-detail";
import { HistoryScreen } from "@/components/history-screen";

const state = vi.hoisted(() => ({ refresh: undefined as ((event: any) => void) | undefined, api: vi.fn() }));
vi.mock("@/lib/use-cache-events", () => ({
  useCacheEvents: (callback: any) => {
    state.refresh = callback;
  },
}));
vi.mock("@/lib/client-api", () => ({ apiJson: state.api }));
vi.mock("@/components/generated-workspace", () => ({ WorkspaceBoundary: () => null }));
const session = (id: string, status: string) => ({
  id,
  title: `Work ${id}`,
  history_kind: "action",
  status,
  started_at: "2026-10-07T12:00:00Z",
  updated_at: "2026-10-07T12:00:00Z",
  event_count: 1,
});
it("puts uncertain outcomes and confirmed step receipts before the collapsed log", () => {
  const html = renderToStaticMarkup(
    <HistoryDetailView
      initialProposal={null}
      initialData={{
        session: session("write", "error"),
        events: [],
        workspace: null,
        job: {
          status: "needs_review",
          completed: 1,
          total: 2,
          error: "Application restarted during a write",
          source: {},
          steps: [
            { position: 0, status: "complete", action: "mark_read", uid: "1", folder: "INBOX", result: { ok: true } },
            { position: 1, status: "needs_review", action: "move", uid: "1", error: "No receipt" },
          ],
        },
      }}
    />,
  );
  expect(html).toContain("Outcome uncertain");
  expect(html).toContain("1 of 2 steps confirmed");
  expect(html).toContain("Saved receipt");
  expect(html).toContain("never repeated automatically");
  expect(html.indexOf("Saved outcome")).toBeLessThan(html.indexOf("Execution log"));
  expect(html).not.toContain('<details class="history-execution-log" open');
});
it("filters attention items and refreshes saved outcomes without starting work", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<HistoryScreen sessions={[session("review", "needs_review"), session("done", "complete")]} />),
    );
    await act(async () =>
      [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Needs review"))!.click(),
    );
    expect(container.querySelectorAll(".session-link")).toHaveLength(1);
    expect(container.querySelector(".session-link")?.textContent).toContain("Work review");
    state.api.mockResolvedValue({ sessions: [session("done", "complete")] });
    await act(async () => state.refresh!({ type: "cache.refresh" }));
    expect(container.textContent).toContain("No history entries match");
    expect(state.api).toHaveBeenCalledWith("/api/agent/sessions", { cache: "no-store" });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps queued and running jobs visible when filtering In progress", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <HistoryScreen
          sessions={[session("queued", "queued"), session("running", "running"), session("done", "complete")]}
        />,
      ),
    );
    await act(async () =>
      [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("In progress"))!.click(),
    );
    expect(container.querySelectorAll(".session-link")).toHaveLength(2);
    expect(container.querySelector('select[aria-label="History status"]')).toHaveProperty("value", "in_progress");
    expect(container.textContent).toContain("Work queued");
    expect(container.textContent).toContain("Work running");
    expect(container.textContent).not.toContain("Work done");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
