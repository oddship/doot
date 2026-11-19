// @vitest-environment node
import { expect, it, vi } from "vitest";
import { parseArguments, runApi } from "../scripts/doot-api.mjs";

it("requires explicit methods and keeps request paths inside the versioned API", async () => {
  expect(() => parseArguments([])).toThrow("Usage");
  expect(() => parseArguments(["POST", "//foreign.example/path"])).toThrow();
  expect(() => parseArguments(["GET", "/health", "--data-file", "x"])).toThrow();
  await expect(runApi(parseArguments(["GET", "/../../outside"]))).rejects.toThrow("inside /api/v1");
});
it("waits through saved job status without resubmitting a mutation or adding confirmation", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ job: { id: "synthetic-job", status: "queued" } }, { status: 202 }))
    .mockResolvedValueOnce(Response.json({ job: { id: "synthetic-job", status: "running" } }))
    .mockResolvedValueOnce(Response.json({ job: { id: "synthetic-job", status: "complete" } }));
  const result = await runApi(parseArguments(["POST", "/agent/turns", "--data-file", "-", "--wait"]), {
    fetch: fetcher,
    sleep: vi.fn(),
    base: "http://127.0.0.1:8765",
    readStdin: async () => '{"commandId":"synthetic","text":"Review only"}',
  });
  expect(result.completed).toBe(true);
  expect(fetcher.mock.calls.map((call) => call[1].method)).toEqual(["POST", "GET", "GET"]);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty("confirm");
});
it("returns uncertain outcomes without retrying them", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ job: { id: "synthetic-job", status: "outcome_uncertain" } }, { status: 202 }));
  const result = await runApi(parseArguments(["POST", "/proposals/1/approve", "--data-file", "-", "--wait"]), {
    fetch: fetcher,
    readStdin: async () => '{"confirm":true}',
  });
  expect(result.completed).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("preserves the accepted job identifier when polling fails", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ job: { id: "saved-job", status: "running" } }))
    .mockRejectedValueOnce(new Error("Connection lost"));
  await expect(
    runApi(parseArguments(["GET", "/jobs/saved-job", "--wait"]), { fetch: fetcher, sleep: vi.fn() }),
  ).rejects.toThrow("Inspect /jobs/saved-job before retrying");
  expect(fetcher.mock.calls.map((call) => call[1].method)).toEqual(["GET", "GET"]);
});
