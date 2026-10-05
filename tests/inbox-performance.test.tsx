import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxClient } from "@/components/inbox-client";

const { apiJson, toast, replaceClientUrl, localTime } = vi.hoisted(() => ({
  apiJson: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  replaceClientUrl: vi.fn(),
  localTime: vi.fn(),
}));
vi.mock("@/lib/client-api", () => ({ apiJson, errorMessage: (error: Error) => error.message }));
vi.mock("@/components/feedback", () => ({ useToast: () => toast }));
vi.mock("@/lib/client-navigation", () => ({ replaceClientUrl, navigateClient: vi.fn() }));
vi.mock("@/components/local-time", () => ({
  LocalTime: ({ value }: { value: string }) => {
    localTime(value);
    return <span>{value}</span>;
  },
}));
class Socket {
  static instances: Socket[] = [];
  onmessage?: (event: { data: string }) => void;
  close = vi.fn();
  constructor() {
    Socket.instances.push(this);
  }
  send(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
const mails = [1, 2].map((uid) => ({
  account: "work",
  account_email: "work@example.test",
  folder: "INBOX",
  uid: String(uid),
  sender: "sender@example.test",
  subject: `Message ${uid}`,
  date: "2026-01-01",
  body_fetched: 1,
}));
const initial = { messages: mails, total: 2, offset: 0 };
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let container: HTMLDivElement;
let root: Root;
async function render(query = "") {
  await act(async () => root.render(<InboxClient accounts={[]} initial={initial} initialQuery={query} />));
}
async function type(value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search cached email headers"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function open(index: number) {
  await act(async () =>
    container.querySelectorAll(".mail-item")[index].dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  Socket.instances = [];
  localStorage.clear();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  apiJson.mockResolvedValue(initial);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("responsive Inbox requests and rendering", () => {
  it("does not reconnect or rerender unchanged mail rows while typing a draft search", async () => {
    await render("from:sender@example.test");
    const renders = localTime.mock.calls.length;
    await type("unsubmitted");
    await type("unsubmitted search");
    expect(localTime).toHaveBeenCalledTimes(renders);
    expect(Socket.instances).toHaveLength(1);
    expect(apiJson).not.toHaveBeenCalled();
    expect(container.querySelector(".inbox-refine-search")?.textContent).toContain("from:sender@example.test");
  });
  it("reuses unchanged header rows after refresh but rerenders changed cache flags", async () => {
    apiJson.mockResolvedValue({ ...initial, messages: mails.map((mail) => ({ ...mail })) });
    await render();
    const renders = localTime.mock.calls.length;
    await act(async () => Socket.instances[0].send({ type: "cache.refresh", resource: "messages" }));
    expect(localTime).toHaveBeenCalledTimes(renders);
    apiJson.mockResolvedValue({ ...initial, messages: [{ ...mails[0], body_fetched: 0 }, { ...mails[1] }] });
    await act(async () => Socket.instances[0].send({ type: "cache.refresh", resource: "messages" }));
    expect(localTime).toHaveBeenCalledTimes(renders + 1);
    expect(container.querySelectorAll(".mail-item")[0].textContent).not.toContain("cached body");
  });

  it("aborts superseded searches and ignores their late results and errors", async () => {
    const first = deferred();
    const second = deferred();
    apiJson.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render();
    await type("first");
    await submit();
    await type("second");
    await submit();
    expect(apiJson.mock.calls[0][1].signal.aborted).toBe(true);
    expect(container.querySelector(".inbox-list")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => second.resolve({ messages: [{ ...mails[1], subject: "Newest result" }], total: 1 }));
    await act(async () => first.reject(new Error("Old search failed")));
    expect(container.querySelector(".mail-scroll")?.textContent).toContain("Newest result");
    expect(container.querySelector(".inbox-list")?.getAttribute("aria-busy")).toBe("false");
    expect(toast.error).not.toHaveBeenCalled();
    expect(replaceClientUrl).toHaveBeenLastCalledWith("/inbox?query=second");
  });
  it("never displays an old body under the newly opened message", async () => {
    const first = deferred();
    const second = deferred();
    apiJson.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render();
    await open(0);
    await open(1);
    expect(apiJson.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => second.resolve({ body_text: "Correct body two" }));
    await act(async () => first.resolve({ body_text: "Stale body one" }));
    expect(container.querySelector(".email-header h1")?.textContent).toBe("Message 2");
    expect(container.querySelector(".plain-content")?.textContent).toBe("Correct body two");
    expect(Socket.instances).toHaveLength(1);
  });
  it("refreshes the submitted search, not an unsubmitted draft, and safely closes removed mail", async () => {
    const body = deferred();
    apiJson.mockReturnValueOnce(body.promise).mockResolvedValue(initial);
    await render("from:sender@example.test");
    await open(0);
    await type("unsubmitted");
    await act(async () =>
      Socket.instances[0].send({
        type: "cache.refresh",
        resource: "messages",
        items: [{ account: "work", uid: "1", source_folder: "INBOX" }],
      }),
    );
    expect(apiJson.mock.calls[0][1].signal.aborted).toBe(true);
    expect(apiJson.mock.calls[1][0]).toContain("query=from%3Asender%40example.test");
    await act(async () => body.resolve({ body_text: "Removed message body" }));
    expect(container.querySelector(".reader-empty")).not.toBeNull();
    expect(container.textContent).not.toContain("Removed message body");
  });
  it("coalesces cache-refresh bursts without replacing a pending user search", async () => {
    const search = deferred();
    apiJson.mockReturnValueOnce(search.promise).mockResolvedValue(initial);
    await render();
    await type("new search");
    await submit();
    await act(async () => {
      Socket.instances[0].send({ type: "cache.refresh", resource: "messages" });
      Socket.instances[0].send({ type: "cache.refresh", resource: "messages" });
    });
    expect(apiJson).toHaveBeenCalledTimes(1);
    expect(apiJson.mock.calls[0][1].signal.aborted).toBe(false);
    await act(async () => search.resolve(initial));
    expect(apiJson).toHaveBeenCalledTimes(2);
    expect(apiJson.mock.calls[1][0]).toContain("query=new%20search");
    expect(replaceClientUrl).toHaveBeenLastCalledWith("/inbox?query=new+search");
  });

  it("cancels requests and disconnects on unmount", async () => {
    const body = deferred();
    const search = deferred();
    apiJson.mockReturnValueOnce(body.promise).mockReturnValueOnce(search.promise);
    await render();
    await open(0);
    await submit();
    await act(async () => root.unmount());
    expect(apiJson.mock.calls.every(([, init]) => init.signal.aborted)).toBe(true);
    expect(Socket.instances[0].close).toHaveBeenCalledTimes(1);
    await act(async () => {
      body.resolve({ body_text: "Too late" });
      search.resolve(initial);
    });
  });
});
