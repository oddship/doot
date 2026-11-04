// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({ store: vi.fn().mockResolvedValue({ warm: true }) }));
vi.mock("@/lib/store", () => ({ store }));
vi.mock("@/lib/background-jobs", () => ({ approveFolderMutation: vi.fn() }));
vi.mock("@/lib/history", () => ({ startHistory: vi.fn() }));

import { handleAccountRoutes } from "@/lib/api/account-routes";

it("retains bodyless startup warming and supports the requested folder", async () => {
  for (const folder of [undefined, "Archive"]) {
    const request = new Request("http://127.0.0.1:8765/api/accounts/work/warm", {
      method: "POST",
      ...(folder
        ? { headers: { "content-type": "application/json", host: "127.0.0.1:8765" }, body: JSON.stringify({ folder }) }
        : {}),
    });
    const response = await handleAccountRoutes({
      request,
      path: ["accounts", "work", "warm"],
      key: "accounts/work/warm",
      method: "POST",
      url: new URL(request.url),
    });
    expect(response?.status).toBe(200);
    expect(store).toHaveBeenLastCalledWith(["account-warm", "work", folder || "INBOX"]);
  }
});

it("handles an empty Next-style POST stream and keeps startup requests explicit JSON", async () => {
  const request = new Request("http://127.0.0.1:8765/api/accounts/work/warm", {
    method: "POST",
    headers: { "content-length": "0" },
    body: new Uint8Array(0),
  });
  expect(request.body).not.toBeNull();
  const response = await handleAccountRoutes({
    request,
    path: ["accounts", "work", "warm"],
    key: "accounts/work/warm",
    method: "POST",
    url: new URL(request.url),
  });
  expect(response?.status).toBe(200);
  const server = await readFile("server.mjs", "utf8");
  const warm = server.slice(server.indexOf("const warmMessageReaders"), server.indexOf("server.listen"));
  expect(warm).toContain('"Content-Type": "application/json"');
  expect(warm).toContain('body: "{}"');
});
