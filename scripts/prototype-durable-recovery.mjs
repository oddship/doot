// Isolated experiment: no Doot store, credentials, models, network, or real mailbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, defineDoc, defineExtension, defineTask, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const plan = {
  account: "fake",
  folder: "INBOX",
  uid: "1",
  uidValidity: "42",
  actions: ["mark_read", "move"],
  destination: "transactions",
};
const fingerprint = JSON.stringify(plan);
const Review = defineDoc({
  kind: "doot.prototype-review",
  version: 1,
  scope: "session",
  initial: () => ({ fingerprint, approved: false, taskId: null }),
  checkpointWhen: () => true,
});

async function worker(directory, mode) {
  const journal = join(directory, "fake-mailbox.jsonl");
  const Apply = defineTask({
    name: "doot.prototype-apply",
    version: 1,
    initial: () => ({ phase: "intent" }),
    phases: {
      intent: async (_task, runtime, ctx) => {
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "effect" } }), ctx);
      },
      effect: async (task, runtime, ctx) => {
        // A claim proves only that an effect MAY have started, never that it finished.
        if (await runtime.memo("effect-claimed", ctx)) {
          await runtime.commit(
            () => ({
              status: "terminal",
              outcome: {
                status: "failed",
                error: { message: "Outcome unknown; reconcile manually, never replay" },
                result: "needs_reconciliation",
              },
            }),
            ctx,
          );
          return;
        }
        await runtime.memo("effect-claimed", true, ctx);
        if (mode === "crash-before-effect") process.exit(73);
        // The only external effect is a fake journal. Includes the exact reviewed input.
        appendFileSync(journal, `${JSON.stringify(task.input)}\n`);
        if (mode === "crash-after-effect") process.exit(73);
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "completed", result: "fake_applied" } }),
          ctx,
        );
      },
    },
    abort: async (_task, runtime, ctx) => {
      const uncertain = Boolean(await runtime.memo("effect-claimed", ctx));
      await runtime.commit(
        () => ({
          status: "terminal",
          outcome: { status: "aborted", result: uncertain ? "needs_reconciliation" : "not_started" },
        }),
        ctx,
      );
    },
  });
  const registry = createRegistry();
  registry.install(defineExtension({ name: "fake-mailbox", tasks: [Apply] }));
  const harness = await Harness.open(
    await openNodeSqliteStorage(join(directory, "durable.sqlite")),
    { models: createModels(), registry },
    context,
  );
  try {
    if (mode === "review") {
      await harness.commit((tx) => tx.doc(Review), context);
    } else if (mode === "stale") {
      await assert.rejects(
        harness.commit(async (tx) => {
          const review = await tx.doc(Review);
          assert.equal(review.fingerprint, "changed-plan", "review changed");
        }, context),
        /review changed/,
      );
    } else if (mode !== "reopen" && mode !== "cancel-reopen") {
      const conversation = await harness.root(context);
      await conversation.commit(async (tx) => {
        const review = await tx.doc(Review);
        assert.equal(review.fingerprint, fingerprint);
        assert.equal(review.taskId, null, "cannot approve twice");
        review.approved = true;
        review.taskId = await tx.createTask(Apply, plan, { ownership: { kind: "conversation" } });
      }, context);
    }
    const review = await harness.snapshot(Review, context);
    let outcome = null;
    if (review.taskId !== null) {
      if (mode === "cancel" || mode === "cancel-reopen") await harness.abortTask(review.taskId, context);
      outcome = (await harness.waitForTask(review.taskId, context)).state.outcome;
    }
    console.log(JSON.stringify({ approved: review.approved, outcome }));
  } finally {
    await harness.close(context);
  }
}

if (process.argv[2] === "--worker") {
  await worker(process.argv[3], process.argv[4]);
} else {
  const base = mkdtempSync(join(tmpdir(), "doot-durable-prototype-"));
  const run = (directory, mode, exit = 0) => {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", directory, mode], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(child.status, exit, child.stderr || child.error?.message);
    return exit === 0 ? JSON.parse(child.stdout.trim()) : null;
  };
  const effects = (directory) =>
    existsSync(join(directory, "fake-mailbox.jsonl"))
      ? readFileSync(join(directory, "fake-mailbox.jsonl"), "utf8").trim().split("\n").length
      : 0;
  try {
    const fresh = () => mkdtempSync(join(base, "case-"));
    const pending = fresh();
    run(pending, "review");
    assert.equal(run(pending, "reopen").approved, false);
    run(pending, "stale");
    assert.equal(effects(pending), 0);
    const completed = fresh();
    assert.equal(run(completed, "approve").outcome.status, "completed");
    assert.equal(run(completed, "reopen").outcome.status, "completed");
    assert.equal(effects(completed), 1);
    const cancelled = fresh();
    assert.equal(run(cancelled, "cancel").outcome.result, "not_started");
    assert.equal(run(cancelled, "reopen").outcome.status, "aborted");
    assert.equal(effects(cancelled), 0);
    for (const [mode, expected] of [
      ["crash-before-effect", 0],
      ["crash-after-effect", 1],
    ]) {
      const directory = fresh();
      run(directory, mode, 73);
      assert.equal(run(directory, "reopen").outcome.result, "needs_reconciliation");
      run(directory, "reopen");
      assert.equal(effects(directory), expected);
    }
    const uncertainCancel = fresh();
    run(uncertainCancel, "crash-after-effect", 73);
    assert.equal(run(uncertainCancel, "cancel-reopen").outcome.result, "needs_reconciliation");
    assert.equal(effects(uncertainCancel), 1);
    console.log(
      "PASS: approval survives restart; stale review rejected; cancellation persists; completed work not repeated; crashes before/after fake mutation require reconciliation without replay.",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
