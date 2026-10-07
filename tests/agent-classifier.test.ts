// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { CLASSIFIER_LIMITS, createClassifierRegistry, newClassifierBudget } from "@/lib/agent-classifier";
import { createReadOnlyCodemodeExtension } from "@/lib/agent-codemode";

const model = {
  type: "classifier",
  provider: "opencode",
  id: "jev-1.13-free",
  name: "Jev Free",
  api: "typesafe-system-one",
  input: ["text"],
  contextWindow: 32000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  headers: { secret: "never-visible" },
  baseUrl: "https://example.invalid",
} as any;
const context = {
  state: { topics: ["databases", "music"], interests: ["databases"] },
  questions: {
    relevance: {
      type: "choice",
      instructions: "Which topic matches these interests?",
      criteria: { databases: "Database engineering", music: "Music", unknown: "Insufficient evidence" },
    },
  },
} as any;
const answer = {
  api: model.api,
  provider: model.provider,
  model: model.id,
  stopReason: "stop",
  timestamp: 1,
  answers: {
    relevance: {
      type: "choice",
      choice: "databases",
      probabilities: { databases: 0.9, music: 0.05, unknown: 0.05 },
      confidence: 0.8,
    },
  },
  usage: {
    input: 100,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 110,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
} as any;
function runtime(available: any[] = [model]) {
  return {
    getAvailableOfType: vi.fn(async () => available),
    getModelsOfType: vi.fn(() => [model]),
    classify: vi.fn(async () => answer),
  };
}
async function script(registry: unknown, code: string) {
  let tool: any;
  const writes: any[] = [];
  await createReadOnlyCodemodeExtension(async () => registry)({
    registerTool: (entry: any) => {
      tool = entry;
    },
    getAllTools: () => [],
    appendEntry: (type: string, data: unknown) => writes.push({ type, data }),
  } as any);
  const result = await tool.execute("classify-test", { code }, new AbortController().signal, undefined, {
    tools: [],
    sessionManager: { getBranch: () => [] },
  } as any);
  return { result, writes, text: result.content.map((block: any) => block.text || "").join("\n") };
}

describe("configured codemode classifiers", () => {
  it("runs agent-authored questions through the real Pi sandbox, with usage and session storage", async () => {
    const host = runtime();
    const budget = newClassifierBudget();
    const audit = vi.fn();
    const registry = await createClassifierRegistry(host, {}, budget, undefined, audit);
    const output = await script(
      registry,
      `const [model] = await models.getAvailableOfType("classifier"); const result = await models.classify(model, ${JSON.stringify(context)}); store("relevance", result.answers); return result;`,
    );
    expect(output.text).toContain('"choice":"databases"');
    expect(output.result.isError).toBeUndefined();
    expect(output.result.usage.totalTokens).toBe(110);
    expect(output.writes[0].type).toBe("codemode-store");
    expect(host.classify).toHaveBeenCalledWith(
      model,
      context,
      expect.objectContaining({ timeoutMs: 15000, maxRetries: 0, signal: expect.any(AbortSignal) }),
    );
    expect(budget.calls).toBe(1);
    expect(budget.running).toBe(0);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ questions: context.questions, answers: answer.answers }),
    );
  });

  it("honors an explicit preference and does not reveal secrets, chat or image models", async () => {
    const other = { ...model, provider: "other", id: "other-model" };
    const registry = await createClassifierRegistry(
      runtime([model, other]),
      { classifier_provider: "other", classifier_model: "other-model" },
      newClassifierBudget(),
    );
    const output = await script(
      registry,
      'return {available: await models.getAvailableOfType("classifier"), chat: await models.getAvailableOfType("chat"), images: await models.getAvailableOfType("image"), process: typeof process, fetch: typeof fetch};',
    );
    expect(output.text).toContain('"id":"other-model"');
    expect(output.text).not.toContain("never-visible");
    expect(output.text).not.toContain("baseUrl");
    expect(output.text).toContain('"chat":[]');
    expect(output.text).toContain('"images":[]');
    expect(output.text).toContain('"process":"undefined"');
    expect(output.text).toContain('"fetch":"undefined"');
    await expect(registry.generateImages()).rejects.toThrow("classification only");
    await expect(registry.classify(model, context)).rejects.toThrow("configured classification model");
  });

  it("does not silently replace an unavailable preferred model", async () => {
    const host = runtime();
    const registry = await createClassifierRegistry(
      host,
      { classifier_provider: "missing", classifier_model: "missing" },
      newClassifierBudget(),
    );
    expect(await registry.getAvailableOfType("classifier")).toEqual([]);
    await expect(registry.classify(model, context)).rejects.toThrow("selected classification model is unavailable");
    expect(host.classify).not.toHaveBeenCalled();
  });

  it("reuses a Go key only for Zen without exposing it or copying stored credentials", async () => {
    const host = runtime([]);
    const registry = await createClassifierRegistry(host, {}, newClassifierBudget(), {
      type: "api_key",
      key: "test-shared-key",
    });
    await registry.classify(model, context);
    expect(host.classify).toHaveBeenCalledWith(model, context, expect.objectContaining({ apiKey: "test-shared-key" }));
    expect(JSON.stringify(await registry.getAvailableOfType("classifier"))).not.toContain("test-shared-key");
  });

  it("enforces request, question, run, concurrency and cancellation limits before provider calls", async () => {
    const host = runtime();
    const budget = newClassifierBudget();
    const registry = await createClassifierRegistry(host, {}, budget);
    await expect(
      registry.classify(model, { ...context, state: { body: "x".repeat(CLASSIFIER_LIMITS.inputChars) } }),
    ).rejects.toThrow("input exceeds");
    await expect(
      registry.classify(model, {
        ...context,
        questions: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`q${i}`, context.questions.relevance])),
      }),
    ).rejects.toThrow("twelve");
    budget.calls = CLASSIFIER_LIMITS.calls;
    await expect(registry.classify(model, context)).rejects.toThrow("run budget");
    budget.calls = 0;
    budget.inputChars = CLASSIFIER_LIMITS.runChars;
    await expect(registry.classify(model, context)).rejects.toThrow("run budget");
    budget.inputChars = 0;
    budget.running = 4;
    await expect(registry.classify(model, context)).rejects.toThrow("simultaneous");
    budget.running = 0;
    budget.cost = CLASSIFIER_LIMITS.cost + 1;
    await expect(registry.classify(model, context)).rejects.toThrow("cost budget");
    const abort = new AbortController();
    abort.abort();
    await expect(registry.classify(model, context, { signal: abort.signal })).rejects.toThrow();
    expect(host.classify).not.toHaveBeenCalled();
  });
});
