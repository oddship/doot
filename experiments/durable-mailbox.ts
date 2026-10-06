// Experimental, test-only workflow. Never imported by Doot's app/runtime.
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  type ConversationId,
  createRegistry,
  defineDoc,
  defineExtension,
  defineTask,
  Harness,
  type Storage,
  type TaskId,
} from "@earendil-works/pi-durable";

export type Ref = { account: string; folder: string; uid: string; uidValidity: string };
export type Plan = { messages: Ref[]; actions: ["mark_read", "move"]; destination: string };
export type Step = { ref: Ref; operation: "seen" | "add_label" | "remove_source"; destination: string };
export type Receipt = { index: number; step: Step };
type Status = "pending" | "approved" | "applied" | "failed" | "needs_reconciliation" | "cancelled";
type ReviewState = {
  plan: Plan | null;
  fingerprint: string;
  taskId: number | null;
  status: Status;
  receipts: Receipt[];
  error: string | null;
};

// Only a mock transport can be supplied; no production IMAP client/credential imports.
export interface MockMailboxTransport {
  readonly mock: true;
  validate(ref: Ref, signal: AbortSignal): Promise<void>;
  execute(step: Step, signal: AbortSignal): Promise<void>;
}
// This means the mock server explicitly rejected a command before applying it.
export class MockCommandRejected extends Error {}

const Review = defineDoc<ReviewState>({
  kind: "doot.experiment-mailbox-review",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ plan: null, fingerprint: "", taskId: null, status: "pending", receipts: [], error: null }),
  checkpointWhen: () => true,
});
const stepsFor = (plan: Plan): Step[] =>
  plan.messages.flatMap((ref) =>
    (["seen", "add_label", "remove_source"] as const).map((operation) => ({
      ref,
      operation,
      destination: plan.destination,
    })),
  );
function validatePlan(plan: Plan) {
  if (
    !plan ||
    !Array.isArray(plan.messages) ||
    plan.messages.length < 1 ||
    plan.messages.length > 5 ||
    JSON.stringify(plan.actions) !== '["mark_read","move"]' ||
    !plan.destination?.trim()
  )
    throw new Error("Choose 1–5 exact mock messages and mark_read → move");
  const keys = new Set<string>();
  for (const ref of plan.messages) {
    if (
      !ref.account ||
      !ref.folder ||
      !/^[1-9]\d*$/.test(ref.uid) ||
      Number(ref.uid) > 0xffffffff ||
      !/^[1-9]\d*$/.test(ref.uidValidity) ||
      ref.folder === plan.destination
    )
      throw new Error("Invalid exact mock message identity or destination");
    const key = JSON.stringify([ref.account, ref.folder, ref.uid]);
    if (keys.has(key)) throw new Error("Duplicate mock message");
    keys.add(key);
  }
}

export async function openMockMailboxWorkflow(storage: Storage, transport: MockMailboxTransport) {
  if (transport.mock !== true) throw new Error("Only a mock transport is allowed");
  const Apply = defineTask<Plan, { phase: "step"; index: number }, { status: Status }>({
    name: "doot.experiment-mailbox-apply",
    version: 1,
    initial: () => ({ phase: "step", index: 0 }),
    phases: {
      step: async (task, runtime, ctx) => {
        const index = task.state.checkpoint.index;
        const step = stepsFor(task.input)[index];
        const finish = async (status: "failed" | "needs_reconciliation", error: string) => {
          await runtime.commit(async (tx) => {
            const review = await tx.doc(Review, task.conversationId);
            review.status = status;
            review.error = error;
            await tx.appendEntry(task.conversationId, {
              kind: "doot.experiment-outcome",
              data: { status, error, index },
            });
            return { status: "terminal", outcome: { status: "failed", error: { message: error }, result: { status } } };
          }, ctx);
        };
        // Durable custom phases resume; a persisted claim is NOT permission to retry.
        if (await runtime.memo(`claim:${index}`, ctx)) {
          await finish("needs_reconciliation", "Uncertain command outcome; do not replay");
          return;
        }
        try {
          const review = await runtime.snapshot(Review, task.conversationId, ctx);
          if (review?.status !== "approved" || review.fingerprint !== JSON.stringify(task.input))
            throw new Error("Missing exact approval");
          // Check every step: source UIDs/UIDVALIDITY can change between commands.
          await transport.validate(step.ref, runtime.signal);
        } catch (error) {
          if (runtime.signal.aborted) throw error;
          await finish("failed", String(error));
          return;
        }
        await runtime.memo(`claim:${index}`, true, ctx);
        await runtime.commit(async (tx) => {
          await tx.appendEntry(task.conversationId, { kind: "doot.experiment-intent", data: { index, step } });
          return undefined;
        }, ctx);
        try {
          await transport.execute(step, runtime.signal);
        } catch (error) {
          if (runtime.signal.aborted) throw error;
          await finish(error instanceof MockCommandRejected ? "failed" : "needs_reconciliation", String(error));
          return;
        }
        await runtime.commit(async (tx) => {
          const review = await tx.doc(Review, task.conversationId);
          review.receipts.push({ index, step });
          const done = index === stepsFor(task.input).length - 1;
          if (done) review.status = "applied";
          await tx.appendEntry(task.conversationId, { kind: "doot.experiment-receipt", data: { index, step } });
          return done
            ? { status: "terminal", outcome: { status: "completed", result: { status: "applied" } } }
            : { status: "running", checkpoint: { phase: "step", index: index + 1 } };
        }, ctx);
      },
    },
    abort: async (task, runtime, ctx) => {
      const claimed = Boolean(await runtime.memo(`claim:${task.state.checkpoint.index}`, ctx));
      await runtime.commit(async (tx) => {
        const review = await tx.doc(Review, task.conversationId);
        const status = claimed ? "needs_reconciliation" : "cancelled";
        review.status = status;
        review.error = claimed ? "Cancelled with an uncertain command outcome" : null;
        await tx.appendEntry(task.conversationId, { kind: "doot.experiment-cancelled", data: { status } });
        return { status: "terminal", outcome: { status: "aborted", result: { status } } };
      }, ctx);
    },
  });
  const registry = createRegistry();
  registry.install(defineExtension({ name: "mock-mailbox-only", tasks: [Apply] }));
  const harness = await Harness.open(storage, { models: createModels(), registry }, context);
  const get = async (id: ConversationId) => {
    const review = await harness.snapshot(Review, id, context);
    if (!review?.plan) throw new Error("Unknown review");
    // Never hand mutable browser code a tracker-owned revision.
    return JSON.parse(JSON.stringify(review)) as ReviewState;
  };
  return {
    harness,
    async create(plan: Plan) {
      validatePlan(plan);
      const copy = JSON.parse(JSON.stringify(plan)) as Plan;
      const conversation = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
      await conversation.commit(async (tx) => {
        const review = await tx.doc(Review, conversation.id);
        review.plan = copy;
        review.fingerprint = JSON.stringify(copy);
        await tx.appendEntry(conversation.id, { kind: "doot.experiment-review", data: { plan: copy } });
      }, context);
      return conversation.id;
    },
    get,
    async approve(id: ConversationId, expected: string, confirm: boolean) {
      if (confirm !== true) throw new Error("Browser confirmation required");
      const conversation = await harness.conversation(id, context);
      if (!conversation) throw new Error("Unknown review");
      await conversation.commit(async (tx) => {
        const review = await tx.doc(Review, id);
        if (!review.plan || review.fingerprint !== expected) throw new Error("Review changed; preview again");
        if (review.status !== "pending" || review.taskId !== null) throw new Error("Review is no longer pending");
        review.status = "approved";
        review.taskId = await tx.createTask(Apply, review.plan, { ownership: { kind: "conversation" } });
        await tx.appendEntry(id, { kind: "doot.experiment-approved", data: { fingerprint: expected } });
      }, context);
      harness.resume();
    },
    async cancel(id: ConversationId) {
      const review = await get(id);
      if (review.taskId !== null) {
        await harness.abortTask(review.taskId as TaskId, context);
        await harness.waitForTask(review.taskId as TaskId, context);
      } else {
        await harness.commit(async (tx) => {
          const current = await tx.doc(Review, id);
          // Recheck on the Session line; approval might have raced this read.
          if (current.taskId !== null) throw new Error("Approval raced cancellation; cancel again");
          current.status = "cancelled";
          await tx.appendEntry(id, { kind: "doot.experiment-cancelled", data: { status: "cancelled" } });
        }, context);
      }
      return get(id);
    },
    async wait(id: ConversationId) {
      const review = await get(id);
      if (review.taskId !== null) await harness.waitForTask(review.taskId as TaskId, context);
      return get(id);
    },
    close: () => harness.close(context),
  };
}
export type MockMailboxWorkflow = Awaited<ReturnType<typeof openMockMailboxWorkflow>>;

// Framework-neutral browser adapter, deliberately NOT mounted in Next.js.
export async function handleMockReviewRequest(workflow: MockMailboxWorkflow, request: Request) {
  try {
    const match = new URL(request.url).pathname.match(/^\/mock-reviews\/([1-9]\d*)(?:\/(approve|cancel))?$/);
    if (!match) return Response.json({ error: "Not found" }, { status: 404 });
    const id = Number(match[1]) as ConversationId;
    if (request.method === "GET" && !match[2]) return Response.json(await workflow.get(id));
    if (request.method !== "POST" || !match[2]) return Response.json({ error: "Method not allowed" }, { status: 405 });
    const value = await request.json();
    if (value.confirm !== true) throw new Error("Browser confirmation required");
    if (match[2] === "approve") {
      if (typeof value.expected !== "string") throw new Error("Reviewed fingerprint required");
      await workflow.approve(id, value.expected, true);
      return Response.json({ accepted: true }, { status: 202 });
    }
    return Response.json(await workflow.cancel(id));
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 409 });
  }
}
