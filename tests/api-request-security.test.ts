// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { routeHandler, enqueue } = vi.hoisted(() => ({ routeHandler: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/api/routes", () => ({ API_ROUTE_HANDLERS: [routeHandler] }));
vi.mock("@/lib/agent-jobs", () => ({ enqueueAgentTurn: enqueue, observeAgentJob: vi.fn() }));
vi.mock("@/lib/ui-message-stream", () => ({ createDetachedUIMessageStream: () => new ReadableStream() }));

import { POST as apiPost } from "@/app/api/[...path]/route";
import { POST as chatPost } from "@/app/api/chat/route";

beforeEach(() => {
  vi.clearAllMocks();
  routeHandler.mockResolvedValue(Response.json({ ok: true }));
  enqueue.mockReturnValue({ id: "job" });
});

function request(path: string, origin: string, contentType?: string, body?: string) {
  return new Request(`http://127.0.0.1:8765/api/${path}`, {
    method: "POST",
    headers: { host: "127.0.0.1:8765", origin, ...(contentType ? { "content-type": contentType } : {}) },
    body,
  });
}

describe("API entry-point security", () => {
  it("blocks foreign-origin bodyless mutations before invoking any route", async () => {
    const response = await apiPost(request("sync", "https://attacker.example"), {
      params: Promise.resolve({ path: ["sync"] }),
    });
    expect(response.status).toBe(403);
    expect(routeHandler).not.toHaveBeenCalled();
  });

  it("allows a trusted bodyless request through to the route", async () => {
    const response = await apiPost(request("sync", "http://127.0.0.1:8765"), {
      params: Promise.resolve({ path: ["sync"] }),
    });
    expect(response.status).toBe(200);
    expect(routeHandler).toHaveBeenCalledOnce();
  });

  it.each([
    ["https://attacker.example", "application/json", 403],
    ["https://attacker.example", "text/plain", 403],
    ["http://127.0.0.1:8765", "text/plain", 415],
  ])("rejects chat requests from %s using %s before enqueueing", async (origin, contentType, status) => {
    const response = await chatPost(request("chat", origin as string, contentType as string, '{"text":"test"}'));
    expect(response.status).toBe(status);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("accepts trusted JSON chat requests", async () => {
    const response = await chatPost(request("chat", "http://127.0.0.1:8765", "application/json", '{"text":"test"}'));
    expect(response.status).toBe(200);
    expect(enqueue).toHaveBeenCalledOnce();
  });
});
