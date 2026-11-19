// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const directory = mkdtempSync(path.join(tmpdir(), "doot-body-review-"));
process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite");
const { db } = await import("@/lib/database");
const { createApprovedBodyReview, readReviewNext, recordReviewDecisions, reviewProgress } = await import(
  "@/lib/body-review"
);
const refs = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ account: "synthetic", folder: "INBOX", uid: String(index + 1) }));
function approve(count: number, id = "snapshot") {
  const messages = refs(count);
  db.prepare(
    "INSERT OR IGNORE INTO agent_sessions(id,title,started_at,updated_at) VALUES('session-test','Synthetic','now','now')",
  ).run();
  db.prepare(
    "INSERT INTO agent_events(session_id,event_type,metadata_json,created_at) VALUES('session-test','body_read_requested',?,'now')",
  ).run(JSON.stringify({ request: { id, messages } }));
  db.prepare("INSERT INTO app_state(key,value_json) VALUES(?,?)").run(
    `body-decision:session-test:${id}`,
    '{"status":"approved"}',
  );
  createApprovedBodyReview("session-test", id);
  return messages;
}
const reader = (length = 80) =>
  vi.fn(async (messages: any[]) => ({ messages: messages.map((ref) => ({ ...ref, body_text: "x".repeat(length) })) }));
beforeEach(() => {
  vi.useRealTimers();
  db.exec("DELETE FROM app_state; DELETE FROM agent_events; DELETE FROM agent_sessions;");
});
afterAll(() => {
  db.close();
  delete (globalThis as any).__emailAgentDatabase;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("application-managed approved body review", () => {
  it("reads and records all 157 once with one exact approval, across turn boundaries", async () => {
    const messages = approve(157);
    const read = reader();
    const supplied: string[] = [];
    for (let call = 0; call < 40; call++) {
      const result = await readReviewNext(
        "session-test",
        "snapshot",
        `turn-${Math.floor(call / 10)}:call-${call}`,
        read,
      );
      if (!result.messages.length) break;
      supplied.push(...result.messages.map((message: any) => message.uid));
      recordReviewDecisions(
        "session-test",
        "snapshot",
        result.messages.map((message: any) => ({
          account: message.account,
          folder: message.folder,
          uid: message.uid,
          disposition: "delete",
          reason: "Synthetic bulk newsletter",
        })),
      );
    }
    expect(supplied).toEqual(messages.map((message) => message.uid));
    expect(new Set(supplied).size).toBe(157);
    expect(read).toHaveBeenCalledTimes(32);
    expect(reviewProgress("session-test", "snapshot")).toMatchObject({
      total: 157,
      bodies_read: 157,
      fully_read: 157,
      decided: 157,
      unread: 0,
      dispositions: { delete: 157 },
    });
    expect(db.prepare("SELECT count(*) count FROM actions").get()).toEqual({ count: 0 });
    expect(() => reviewProgress("another-session", "snapshot")).toThrow("approval");
  });

  it("follows long-body cursors, tracks contiguous ranges and stops on the final page", async () => {
    approve(1);
    const read = reader(35_246);
    const initial = await readReviewNext("session-test", "snapshot", "initial", read);
    expect(initial.messages[0]).toMatchObject({ body_offset: 0, body_next_offset: 2000, body_has_more: true });
    expect(initial.progress).toMatchObject({ bodies_read: 1, fully_read: 0 });
    expect((await readReviewNext("session-test", "snapshot", "initial-again", read)).messages).toEqual([]);
    const offsets: number[] = [];
    for (let call = 0; call < 10; call++) {
      const result = await readReviewNext("session-test", "snapshot", `full-${call}`, read, { depth: "full" });
      if (!result.messages.length) break;
      offsets.push(result.messages[0].body_offset);
      if (!result.messages[0].body_has_more) {
        expect(result.messages[0]).toMatchObject({
          body_truncated: true,
          body_next_offset: null,
          body_range_end: 35_246,
        });
      }
    }
    expect(offsets).toEqual([2000, 8000, 14000, 20000, 26000, 32000]);
    expect(reviewProgress("session-test", "snapshot").messages[0]).toMatchObject({
      fully_read: true,
      covered_ranges: [[0, 35_246]],
      next_body_offset: null,
    });
    expect(read).toHaveBeenCalledTimes(7);
  });

  it("does not silently add new arrivals to a saved scope", async () => {
    approve(1);
    db.prepare("UPDATE agent_events SET metadata_json=? WHERE event_type='body_read_requested'").run(
      JSON.stringify({ request: { id: "snapshot", messages: refs(2) } }),
    );
    expect(createApprovedBodyReview("session-test", "snapshot").total).toBe(1);
    await expect(
      readReviewNext("session-test", "snapshot", "outside", reader(), { messages: [refs(2)[1]] }),
    ).rejects.toThrow("outside");
    await expect(
      readReviewNext("session-test", "snapshot", "wrong-folder", reader(), {
        messages: [{ ...refs(1)[0], folder: "Trash" }],
      }),
    ).rejects.toThrow("outside");
  });

  it("requires saved explicit approval and rolls back mixed invalid decisions", async () => {
    expect(() => createApprovedBodyReview("session-test", "absent")).toThrow("approval");
    approve(2);
    const verdict = { ...refs(2)[0], disposition: "delete" as const, reason: "Synthetic" };
    expect(() => recordReviewDecisions("session-test", "snapshot", [verdict])).toThrow("Read the initial");
    await readReviewNext("session-test", "snapshot", "read", reader());
    expect(() => recordReviewDecisions("session-test", "snapshot", [verdict, { ...verdict, uid: "999" }])).toThrow(
      "inside",
    );
    expect(reviewProgress("session-test", "snapshot").decided).toBe(0);
    recordReviewDecisions("session-test", "snapshot", [verdict]);
    recordReviewDecisions("session-test", "snapshot", [{ ...verdict, disposition: "uncertain" }]);
    expect(reviewProgress("session-test", "snapshot")).toMatchObject({
      decided: 1,
      dispositions: { delete: 0, uncertain: 1 },
    });
  });

  it("replays a completed call without advancing to different messages", async () => {
    approve(10);
    const read = reader();
    const first = await readReviewNext("session-test", "snapshot", "call", read);
    const replay = await readReviewNext("session-test", "snapshot", "call", read);
    expect(replay.messages).toEqual(first.messages);
    expect(replay.progress.bodies_read).toBe(5);
    const next = await readReviewNext("session-test", "snapshot", "next", read);
    expect(next.messages[0].uid).toBe("6");
  });

  it("reserves disjoint chunks for concurrent calls and releases failed reads", async () => {
    approve(10);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = readReviewNext("session-test", "snapshot", "first", async (messages) => {
      await gate;
      return reader()(messages);
    });
    const duplicate = await readReviewNext("session-test", "snapshot", "first", reader());
    expect(duplicate.status).toBe("busy");
    const second = await readReviewNext("session-test", "snapshot", "second", reader());
    expect(second.messages.map((message) => message.uid)).toEqual(["6", "7", "8", "9", "10"]);
    release();
    await first;
    expect(reviewProgress("session-test", "snapshot").bodies_read).toBe(10);
    approve(1, "failure");
    await expect(
      readReviewNext("session-test", "failure", "failed", async () => {
        throw Error("Synthetic transport failure");
      }),
    ).rejects.toThrow("transport");
    expect((await readReviewNext("session-test", "failure", "retry", reader())).messages[0].uid).toBe("1");
  });

  it("recovers an expired reservation without allowing its late response to corrupt the retry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    approve(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stale = readReviewNext("session-test", "snapshot", "call", async (messages) => {
      await gate;
      return reader()(messages);
    });
    vi.mocked(Date.now).mockReturnValue(122000);
    const retried = await readReviewNext("session-test", "snapshot", "call", reader());
    expect(retried.progress.fully_read).toBe(1);
    release();
    await expect(stale).rejects.toThrow("reservation expired");
    expect((await readReviewNext("session-test", "snapshot", "call", reader())).messages[0].uid).toBe("1");
    vi.restoreAllMocks();
  });
});
