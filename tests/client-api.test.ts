// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiJson } from "@/lib/client-api";

describe("client API helper", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serializes JSON requests consistently", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiJson("/api/example", { method: "POST", json: { value: 1 } })).resolves.toEqual({ ok: true });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe('{"value":1}');
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("normalizes API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Nope" }), { status: 422 })));
    await expect(apiJson("/api/example")).rejects.toMatchObject({ message: "Nope", status: 422 });
  });
});
