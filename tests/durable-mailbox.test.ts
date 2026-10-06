// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ConversationId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleMockReviewRequest,
  MockCommandRejected,
  type MockMailboxTransport,
  type MockMailboxWorkflow,
  openMockMailboxWorkflow,
  type Plan,
  type Ref,
  type Step,
} from "../experiments/durable-mailbox";

const ref: Ref = { account: "fake", folder: "INBOX", uid: "1", uidValidity: "42" };
const plan = (): Plan => ({ messages: [{ ...ref }], actions: ["mark_read", "move"], destination: "transactions" });
const untilAbort = (signal: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(new Error("cancelled"));
    else signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  });
class MockImap implements MockMailboxTransport {
  readonly mock = true;
  validity = "42";
  present = true;
  calls: Step[] = [];
  seen = new Set<string>();
  labels = new Map<string, Set<string>>();
  beforeValidate?: (signal: AbortSignal) => Promise<void>;
  beforeExecute?: (step: Step) => void;
  afterExecute?: (step: Step, signal: AbortSignal) => Promise<void>;
  async validate(value: Ref, signal: AbortSignal) {
    await this.beforeValidate?.(signal);
    if (signal.aborted) throw new Error("cancelled");
    if (value.uidValidity !== this.validity) throw new Error("UIDVALIDITY changed");
    if (!this.present) throw new Error("Source UID is absent");
  }
  async execute(step: Step, signal: AbortSignal) {
    if (signal.aborted) throw new Error("cancelled");
    this.calls.push(step);
    this.beforeExecute?.(step);
    const uid = step.ref.uid;
    const labels = this.labels.get(uid) || new Set(["INBOX"]);
    this.labels.set(uid, labels);
    if (step.operation === "seen") this.seen.add(uid);
    else if (step.operation === "add_label") labels.add(step.destination);
    else labels.delete(step.ref.folder);
    await this.afterExecute?.(step, signal);
  }
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup(mock = new MockImap()) {
  const directory = mkdtempSync(path.join(tmpdir(), "doot-mock-workflow-"));
  cleanup.push(async () => rmSync(directory, { recursive: true, force: true }));
  const open = async () => {
    const workflow = await openMockMailboxWorkflow(
      await openNodeSqliteStorage(path.join(directory, "session.sqlite")),
      mock,
    );
    cleanup.push(() => workflow.close());
    return workflow;
  };
  return { mock, open, workflow: await open() };
}
async function browser(workflow: MockMailboxWorkflow, id: ConversationId, action = "", body?: unknown) {
  return handleMockReviewRequest(
    workflow,
    new Request(
      `http://localhost/mock-reviews/${id}${action ? `/${action}` : ""}`,
      body === undefined
        ? undefined
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    ),
  );
}
async function approve(workflow: MockMailboxWorkflow, id: ConversationId) {
  const review = await (await browser(workflow, id)).json();
  expect((await browser(workflow, id, "approve", { confirm: true, expected: review.fingerprint })).status).toBe(202);
}

describe("isolated Durable mock-mailbox browser workflow", () => {
  it("admits only one of two concurrent browser approvals and detaches browser snapshots", async () => {
    const { workflow, mock } = await setup();
    const id = await workflow.create(plan());
    const snapshot = await workflow.get(id);
    snapshot.plan!.messages[0].uid = "999";
    expect((await workflow.get(id)).plan!.messages[0].uid).toBe("1");
    const responses = await Promise.all(
      [1, 2].map(() => browser(workflow, id, "approve", { confirm: true, expected: snapshot.fingerprint })),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    await workflow.wait(id);
    expect(mock.calls).toHaveLength(3);
  });
  it("does not write a source UID that disappeared after review", async () => {
    const { workflow, mock } = await setup();
    const id = await workflow.create(plan());
    mock.present = false;
    await approve(workflow, id);
    expect((await workflow.wait(id)).error).toContain("Source UID is absent");
    expect(mock.calls).toEqual([]);
  });
  it("reopens an unapproved exact snapshot without executing or inheriting approval on forks", async () => {
    const { workflow, open, mock } = await setup();
    const input = plan();
    const id = await workflow.create(input);
    input.messages[0].uid = "999";
    await workflow.close();
    const reopened = await open();
    expect((await reopened.get(id)).plan?.messages[0].uid).toBe("1");
    expect(mock.calls).toEqual([]);
    const conversation = (await reopened.harness.conversation(id, context))!;
    const entry = (await conversation.entries({}, 1, undefined, context)).items[0];
    const fork = await conversation.fork(entry.id, { ownership: { kind: "ownerless" } }, context);
    await expect(reopened.get(fork.id)).rejects.toThrow("Unknown review");
  });
  it("requires exact browser confirmation, records receipts and cannot apply twice", async () => {
    const { workflow, mock, open } = await setup();
    const id = await workflow.create(plan());
    expect((await browser(workflow, id, "approve", { expected: (await workflow.get(id)).fingerprint })).status).toBe(
      409,
    );
    expect((await browser(workflow, id, "approve", { confirm: true, expected: "changed" })).status).toBe(409);
    expect(mock.calls).toEqual([]);
    await approve(workflow, id);
    expect((await workflow.wait(id)).receipts.map((receipt) => receipt.step.operation)).toEqual([
      "seen",
      "add_label",
      "remove_source",
    ]);
    expect(mock.labels.get("1")).toEqual(new Set(["transactions"]));
    await workflow.close();
    const reopened = await open();
    expect((await reopened.wait(id)).status).toBe("applied");
    expect(
      (await browser(reopened, id, "approve", { confirm: true, expected: (await reopened.get(id)).fingerprint }))
        .status,
    ).toBe(409);
    expect(mock.calls).toHaveLength(3);
    const conversation = (await reopened.harness.conversation(id, context))!;
    const audit = (await conversation.entries({}, 100, undefined, context)).items;
    expect(audit.filter((entry) => entry.kind === "doot.experiment-intent")).toHaveLength(3);
    expect(audit.filter((entry) => entry.kind === "doot.experiment-receipt")).toHaveLength(3);
    expect(audit.filter((entry) => entry.kind === "doot.experiment-approved")).toHaveLength(1);
  });
  it("retains successful seen/label receipts when source-label removal is explicitly rejected", async () => {
    const { workflow, mock } = await setup();
    mock.beforeExecute = (step) => {
      if (step.operation === "remove_source") throw new MockCommandRejected("NO remove rejected");
    };
    const id = await workflow.create(plan());
    await approve(workflow, id);
    const result = await workflow.wait(id);
    expect(result.status).toBe("failed");
    expect(result.receipts).toHaveLength(2);
    expect(mock.seen.has("1")).toBe(true);
    expect(mock.labels.get("1")).toEqual(new Set(["INBOX", "transactions"]));
  });
  it("treats a lost acknowledgement as uncertain and never retries even on reopen", async () => {
    const { workflow, mock, open } = await setup();
    mock.afterExecute = async (step) => {
      if (step.operation === "add_label") throw new Error("Socket closed before acknowledgement");
    };
    const id = await workflow.create(plan());
    await approve(workflow, id);
    const result = await workflow.wait(id);
    expect(result.status).toBe("needs_reconciliation");
    expect(result.receipts).toHaveLength(1);
    expect(mock.labels.get("1")?.has("transactions")).toBe(true);
    await workflow.close();
    expect((await (await open()).wait(id)).status).toBe("needs_reconciliation");
    expect(mock.calls).toHaveLength(2);
  });
  it("reopens an interrupted invocation after the effect without replaying it", async () => {
    const { workflow, mock, open } = await setup();
    let reached!: () => void;
    const reachedEffect = new Promise<void>((resolve) => {
      reached = resolve;
    });
    mock.afterExecute = async (_step, signal) => {
      reached();
      await untilAbort(signal);
    };
    const id = await workflow.create(plan());
    await approve(workflow, id);
    await reachedEffect;
    await workflow.close();
    mock.afterExecute = undefined;
    expect((await (await open()).wait(id)).status).toBe("needs_reconciliation");
    expect(mock.calls).toHaveLength(1);
    expect(mock.seen.has("1")).toBe(true);
  });
  it("rejects changed UIDVALIDITY before writing and between steps", async () => {
    const { workflow, mock } = await setup();
    mock.validity = "43";
    const first = await workflow.create(plan());
    await approve(workflow, first);
    expect((await workflow.wait(first)).status).toBe("failed");
    expect(mock.calls).toEqual([]);
    mock.validity = "42";
    mock.afterExecute = async () => {
      mock.validity = "43";
    };
    const second = await workflow.create(plan());
    await approve(workflow, second);
    expect((await workflow.wait(second)).receipts).toHaveLength(1);
    expect(mock.calls).toHaveLength(1);
  });
  it("stops a batch at the first uncertain command and retains earlier messages' receipts", async () => {
    const { workflow, mock } = await setup();
    mock.afterExecute = async (step) => {
      if (step.ref.uid === "2") throw new Error("lost ACK");
    };
    const input = plan();
    input.messages.push({ ...ref, uid: "2" }, { ...ref, uid: "3" });
    const id = await workflow.create(input);
    await approve(workflow, id);
    const result = await workflow.wait(id);
    expect(result.status).toBe("needs_reconciliation");
    expect(result.receipts).toHaveLength(3);
    expect(mock.calls).toHaveLength(4);
    expect(mock.calls.some((step) => step.ref.uid === "3")).toBe(false);
  });
  it("cancels pending review and prevents later approval", async () => {
    const { workflow, mock } = await setup();
    const id = await workflow.create(plan());
    expect((await browser(workflow, id, "cancel", { confirm: true })).status).toBe(200);
    expect((await workflow.get(id)).status).toBe("cancelled");
    expect(
      (await browser(workflow, id, "approve", { confirm: true, expected: (await workflow.get(id)).fingerprint }))
        .status,
    ).toBe(409);
    expect(mock.calls).toEqual([]);
  });
  it.each([false, true])("cancellation during mock transport wait preserves uncertainty=%s", async (afterEffect) => {
    const { workflow, mock, open } = await setup();
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    if (afterEffect)
      mock.afterExecute = async (_step, signal) => {
        reached();
        await untilAbort(signal);
      };
    else
      mock.beforeValidate = async (signal) => {
        reached();
        await untilAbort(signal);
      };
    const id = await workflow.create(plan());
    await approve(workflow, id);
    await waiting;
    const response = await browser(workflow, id, "cancel", { confirm: true });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe(afterEffect ? "needs_reconciliation" : "cancelled");
    await workflow.close();
    expect((await (await open()).wait(id)).status).toBe(afterEffect ? "needs_reconciliation" : "cancelled");
    expect(mock.calls).toHaveLength(afterEffect ? 1 : 0);
  });
  it("rejects invalid/duplicate/unbounded snapshots before admission", async () => {
    const { workflow } = await setup();
    const input = plan();
    input.messages.push({ ...ref });
    await expect(workflow.create(input)).rejects.toThrow("Duplicate");
    await expect(
      workflow.create({
        ...plan(),
        messages: Array.from({ length: 6 }, (_, index) => ({ ...ref, uid: String(index + 1) })),
      }),
    ).rejects.toThrow("1–5");
  });
});
