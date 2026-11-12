import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RulesClient } from "@/components/rules-client";
import { ScheduleControls } from "@/components/schedule-controls";

const { apiJson, toast } = vi.hoisted(() => ({
  apiJson: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/client-api", () => ({ apiJson, errorMessage: (e: Error) => e.message }));
vi.mock("@/components/feedback", () => ({ useToast: () => toast, ConfirmDialog: () => null }));
vi.mock("@/lib/client-navigation", () => ({ replaceClientUrl: vi.fn(), navigateClient: vi.fn() }));
vi.mock("@/components/local-time", () => ({ LocalTime: () => <span>Later</span> }));
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { resolve, reject, promise };
}
const rules = [1, 2].map((id) => ({
  id,
  name: `Flow ${id}`,
  account: "all",
  query: `from:sender${id}`,
  action: "archive",
  actions: ["archive"],
  enabled: false,
  status: "draft",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
}));
const result = (name: string, total: number) => ({
  total,
  messages: [
    {
      account: "work",
      account_email: "work@example.test",
      uid: name,
      folder: "INBOX",
      sender: "sender@example.test",
      subject: name,
      date: "2026-01-01",
    },
  ],
});
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const review = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((x) => x.textContent?.includes("Review & run"))!;
const select = async (id: number) =>
  act(async () => container.querySelector<HTMLAnchorElement>(`a[href="/flows/${id}"]`)!.click());
const renderRules = async () =>
  act(async () => root.render(<RulesClient initialRules={rules as any} accounts={[]} folders={[]} />));

it("ignores late Flow A results even when the transport ignores abort", async () => {
  const a = deferred(),
    b = deferred();
  let oldSignal: AbortSignal;
  apiJson.mockImplementation((url: string, options: any) => {
    if (url.includes("/preview")) {
      if (url.includes("/1/")) {
        oldSignal = options.signal;
        return a.promise;
      }
      return b.promise;
    }
    return Promise.resolve({ schedules: [] });
  });
  await renderRules();
  expect(review().disabled).toBe(true);
  await select(2);
  expect(oldSignal!.aborted).toBe(true);
  expect(review().disabled).toBe(true);
  await act(async () => b.resolve(result("Only B", 83)));
  expect(review().disabled).toBe(false);
  expect(container.textContent).toContain("Only B");
  await act(async () => a.resolve(result("Stale A", 1866)));
  expect(container.textContent).not.toContain("Stale A");
  expect(container.querySelector(".rule-match-count strong")?.textContent).toBe("83");
});
it("clears an already loaded preview and keeps review disabled while the new Flow is loading", async () => {
  const b = deferred();
  apiJson.mockImplementation((url: string) =>
    url.includes("/preview")
      ? url.includes("/1/")
        ? Promise.resolve(result("Only A", 1866))
        : b.promise
      : Promise.resolve({ schedules: [] }),
  );
  await renderRules();
  expect(review().disabled).toBe(false);
  await select(2);
  expect(review().disabled).toBe(true);
  expect(container.textContent).not.toContain("Only A");
  expect(container.querySelector(".rule-match-count")).toBeNull();
  await act(async () => b.resolve(result("Only B", 0)));
  expect(review().disabled).toBe(true);
});
it("does not open a previous Flow's review if proposal preparation finishes after selection changes", async () => {
  const prepared = deferred();
  apiJson.mockImplementation((url: string) =>
    url.endsWith("/propose")
      ? prepared.promise
      : url.includes("/preview")
        ? Promise.resolve(result("Match", 1))
        : Promise.resolve({ schedules: [] }),
  );
  await renderRules();
  await act(async () => review().click());
  expect(review().disabled).toBe(true);
  await select(2);
  await act(async () => prepared.resolve({ rule: rules[0], proposal: { id: 7 }, proposed: 1, matched: 1 }));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("does not report a superseded request error against the new Flow", async () => {
  const a = deferred(),
    b = deferred();
  apiJson.mockImplementation((url: string) =>
    url.includes("/preview") ? (url.includes("/1/") ? a.promise : b.promise) : Promise.resolve({ schedules: [] }),
  );
  await renderRules();
  await select(2);
  await act(async () => a.reject(new Error("Old failure")));
  expect(toast.error).not.toHaveBeenCalled();
  expect(review().disabled).toBe(true);
  await act(async () => b.resolve(result("Only B", 3)));
  expect(review().disabled).toBe(false);
});
it("scopes schedules to the current Flow and ignores older schedule results", async () => {
  const a = deferred(),
    b = deferred();
  apiJson.mockImplementation((url: string) => (url.includes("rule_id=1") ? a.promise : b.promise));
  await act(async () => root.render(<ScheduleControls kind="flow" ruleId={1} />));
  await act(async () => root.render(<ScheduleControls kind="flow" ruleId={2} />));
  const schedule = (id: number, frequency: string) => ({
    id,
    kind: "flow",
    rule_id: id,
    frequency,
    timezone: "UTC",
    next_run_at: "2030-01-01T00:00:00Z",
    enabled: true,
  });
  await act(async () => b.resolve({ schedules: [schedule(2, "weekly")] }));
  await act(async () => a.resolve({ schedules: [schedule(1, "daily")] }));
  expect(container.querySelector(".schedule-row strong")?.textContent).toBe("Weekly");
});

it("renders empty Flows on server and client without requesting a preview", async () => {
  const view = <RulesClient initialRules={[]} accounts={[]} folders={[]} />;
  expect(renderToString(view)).toContain("No flows yet.");
  await act(async () => root.render(view));
  expect(container.textContent).toContain("No flows yet.");
  expect(apiJson).not.toHaveBeenCalled();
});
