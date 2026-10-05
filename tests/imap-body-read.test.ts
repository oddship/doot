// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fetchBodyBatches, MAX_BODY_BATCH_BYTES, MAX_MESSAGE_BYTES, planBodyBatches } from "@/lib/imap-body-read";

const metrics = () => ({ metadata_fetches: 0, source_fetches: 0, source_bytes: 0, metadata_ms: 0, source_ms: 0 });

describe("bounded bulk BODY.PEEK reads", () => {
  it("limits both message count and total advertised bytes", () => {
    expect(planBodyBatches(Array.from({ length: 12 }, (_, i) => ({ uid: i + 1, size: 100 })))).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12],
    ]);
    expect(
      planBodyBatches([
        { uid: 1, size: MAX_MESSAGE_BYTES },
        { uid: 2, size: 1 },
      ]),
    ).toEqual([[1], [2]]);
    expect(() => planBodyBatches([{ uid: 1, size: MAX_MESSAGE_BYTES + 1 }])).toThrow("25 MB");
    expect(() => planBodyBatches([{ uid: 1, size: Number.NaN }])).toThrow("invalid size");
  });
  it("reduces five cold reads from ten FETCH commands to two", async () => {
    const client = {
      fetchAll: vi.fn(async (uids: number[], query: any) =>
        uids.map((uid) => (query.size ? { uid, size: 100 } : { uid, source: Buffer.from(`body ${uid}`) })),
      ),
    };
    const consume = vi.fn();
    const timing = metrics();
    await fetchBodyBatches(client as any, [1, 2, 3, 4, 5], consume, timing);
    expect(client.fetchAll).toHaveBeenCalledTimes(2);
    expect(client.fetchAll).toHaveBeenNthCalledWith(1, [1, 2, 3, 4, 5], { uid: true, size: true }, { uid: true });
    expect(client.fetchAll).toHaveBeenNthCalledWith(2, [1, 2, 3, 4, 5], { uid: true, source: true }, { uid: true });
    expect(timing).toMatchObject({ metadata_fetches: 1, source_fetches: 1, source_bytes: 30 });
    expect(consume).toHaveBeenCalledTimes(1);
  });
  it("preflights every message and rejects oversized messages before any body download", async () => {
    const client = {
      fetchAll: vi.fn(async () => [
        { uid: 1, size: 10 },
        { uid: 2, size: MAX_MESSAGE_BYTES + 1 },
      ]),
    };
    await expect(fetchBodyBatches(client as any, [1, 2], vi.fn(), metrics())).rejects.toThrow("25 MB");
    expect(client.fetchAll).toHaveBeenCalledTimes(1);
  });
  it("rejects missing, duplicated, unexpected, and oversized source responses before caching", async () => {
    for (const rows of [
      [],
      [{ uid: 99, source: Buffer.from("x") }],
      [
        { uid: 1, source: Buffer.from("x") },
        { uid: 1, source: Buffer.from("x") },
      ],
      [{ uid: 1, source: Buffer.alloc(MAX_MESSAGE_BYTES + 1) }],
    ]) {
      const client = {
        fetchAll: vi
          .fn()
          .mockResolvedValueOnce([{ uid: 1, size: 10 }])
          .mockResolvedValueOnce(rows),
      };
      const consume = vi.fn();
      await expect(fetchBodyBatches(client as any, [1], consume, metrics())).rejects.toThrow();
      expect(consume).not.toHaveBeenCalled();
    }
  });
  it("rejects combined source bytes exceeding the advertised batch budget", async () => {
    const client = {
      fetchAll: vi
        .fn()
        .mockResolvedValueOnce([
          { uid: 1, size: 10 },
          { uid: 2, size: 10 },
        ])
        .mockResolvedValueOnce([
          { uid: 1, source: Buffer.alloc(MAX_BODY_BATCH_BYTES) },
          { uid: 2, source: Buffer.from("x") },
        ]),
    };
    const consume = vi.fn();
    await expect(fetchBodyBatches(client as any, [1, 2], consume, metrics())).rejects.toThrow("byte budget");
    expect(consume).not.toHaveBeenCalled();
  });
});
