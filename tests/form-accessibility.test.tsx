import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DraftsClient } from "@/components/drafts-client";
import { MemoryManager } from "@/components/memory-manager";
import { ProviderAuthManager } from "@/components/provider-auth-manager";
import { ScheduleControls } from "@/components/schedule-controls";
import { SettingsClient } from "@/components/settings-client";

const { apiJson } = vi.hoisted(() => ({ apiJson: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ apiJson, errorMessage: (e: Error) => e.message }));
vi.mock("@/components/feedback", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
  ConfirmDialog: () => null,
}));
vi.mock("@/lib/use-cache-events", () => ({ useCacheEvents: () => {} }));
vi.mock("@/lib/client-navigation", () => ({ replaceClientUrl: vi.fn(), navigateClient: vi.fn() }));
vi.mock("@/components/local-time", () => ({ LocalTime: () => null }));
let el: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  apiJson.mockResolvedValue({
    schedules: [],
    items: [],
    namespaces: [],
    providers: [],
    models: [],
    classifierModels: [],
    sessions: [],
    accounts: [],
    folders: [],
  });
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(async () => {
  await act(async () => root.unmount());
  el.remove();
  vi.unstubAllGlobals();
});
function assertNamedControls() {
  const controls = [
    ...el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea"),
  ];
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const name =
      control.getAttribute("aria-label") ||
      control
        .getAttribute("aria-labelledby")
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ") ||
      [...(control.labels || [])].map((label) => label.textContent).join(" ");
    expect(name?.trim(), control.outerHTML).toBeTruthy();
    for (const id of (control.getAttribute("aria-describedby") || "").split(" ").filter(Boolean))
      expect(document.getElementById(id), `missing description ${id}`).not.toBeNull();
  }
  const ids = [...el.querySelectorAll("[id]")].map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
}
const click = async (text: string) => {
  const button = [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text));
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
};
it("names Settings model, sync and privacy controls and associates the privacy help", async () => {
  await act(async () =>
    root.render(
      <SettingsClient
        initial={{
          artifacts: [],
          accounts: [],
          settings: { agent_thinking: "low", sync_scope: "inbox", sync_days: 7, sync_limit: 25 },
          models: [],
          providers: [],
          folders: [],
          namespaces: [],
        }}
      />,
    ),
  );
  assertNamedControls();
  const toggles = [...el.querySelectorAll<HTMLInputElement>('#privacy input[type="checkbox"]')];
  expect(toggles).toHaveLength(3);
  for (const control of toggles) {
    expect(control.labels?.length).toBe(1);
    expect(control.getAttribute("aria-describedby")).toBeTruthy();
  }
  await click("Add");
  assertNamedControls();
  expect(el.querySelector<HTMLInputElement>('input[type="email"]')?.required).toBe(true);
});
it("names all Draft editor fields without creating or editing a live draft", async () => {
  const content = {
    account: "work",
    to: ["test@example.test"],
    cc: [],
    bcc: [],
    subject: "Synthetic",
    body: "Fixture",
    references: [],
    context_messages: [],
  };
  await act(async () =>
    root.render(
      <DraftsClient
        initialDrafts={[{ id: 1, content, status: "draft", created_at: "2026-01-01", updated_at: "2026-01-01" }] as any}
        accounts={[{ name: "work", email: "work@example.test" }]}
      />,
    ),
  );
  assertNamedControls();
  expect(el.querySelector("label")?.htmlFor).toBeTruthy();
});
it("names both schedule fields and attaches their timezone/authorization help", async () => {
  await act(async () => root.render(<ScheduleControls kind="sync" />));
  await click("Add schedule");
  assertNamedControls();
  for (const control of el.querySelectorAll("input,select"))
    expect(control.getAttribute("aria-describedby")).toBeTruthy();
});
it("names memory fields and connects JSON validation errors to the value field", async () => {
  await act(async () => root.render(<MemoryManager initialNamespaces={[]} />));
  await click("New memory");
  assertNamedControls();
  const input = el.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "invalid json");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Save memory");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain("valid JSON");
});
it("names provider choice and dynamic login answers and connects their errors", async () => {
  const login = {
    id: "login",
    provider: "fixture",
    provider_name: "Fixture",
    status: "error",
    error: "Invalid key",
    events: [],
    prompt: { id: "key", type: "secret", message: "API key" },
  };
  apiJson.mockResolvedValue(login);
  await act(async () =>
    root.render(
      <ProviderAuthManager
        initialProviders={
          [
            { id: "fixture", name: "Fixture", configured: false, methods: [{ type: "api_key", label: "API key" }] },
          ] as any
        }
        onModels={() => {}}
      />,
    ),
  );
  assertNamedControls();
  await click("API key");
  assertNamedControls();
  const answer = el.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(answer.labels?.[0]?.textContent).toBe("API key");
  expect(document.getElementById(answer.getAttribute("aria-describedby")!)?.textContent).toBe("Invalid key");
});
