import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { HistoryProposalAction } from "@/components/history-proposal-action";

const { apiJson, toast } = vi.hoisted(() => ({ apiJson: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/client-api", () => ({ apiJson, errorMessage: (error: Error) => error.message }));
vi.mock("@/components/feedback", () => ({
  useToast: () => toast,
  ConfirmDialog: ({ open, title, description, onConfirm }: any) =>
    open ? (
      <div>
        {title}
        {description}
        <button type="button" onClick={onConfirm}>
          Confirm
        </button>
      </div>
    ) : null,
}));
it("reviews every step and does not report a partial mutation as success", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  apiJson.mockResolvedValue({ status: "partial_failure" });
  try {
    await act(async () =>
      root.render(
        <HistoryProposalAction
          proposal={{
            id: 1,
            action: "move",
            actions: ["mark_read", "move"],
            status: "proposed",
            items: [{ account: "fake", uid: "1", source_folder: "INBOX", folder: "transactions" }],
          }}
        />,
      ),
    );
    expect(container.textContent).toContain("Mark as read → Move to transactions");
    expect(apiJson).not.toHaveBeenCalled();
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("not atomically");
    expect(apiJson).not.toHaveBeenCalled();
    await act(async () =>
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Confirm")!.click(),
    );
    expect(apiJson).toHaveBeenCalledWith("/api/apply", { method: "POST", json: { id: 1, confirm: true } });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Proposal partly applied", expect.stringContaining("History"));
    expect(container.textContent).toContain("partial_failure");
    expect(container.querySelector("button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
