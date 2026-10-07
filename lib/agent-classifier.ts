import { createHash } from "node:crypto";
import type { ClassifierApi, ClassifierContext, ClassifierModel, Models } from "@earendil-works/pi-ai";
import type { AgentCredential } from "@/lib/agent-credential-store";

export const CLASSIFIER_LIMITS = {
  calls: 40,
  concurrent: 4,
  inputChars: 32_000,
  runChars: 400_000,
  questions: 12,
  timeoutMs: 15_000,
  cost: 0.05,
};
export type ClassifierBudget = { calls: number; inputChars: number; cost: number; running: number };
export const newClassifierBudget = (): ClassifierBudget => ({ calls: 0, inputChars: 0, cost: 0, running: 0 });

type Runtime = Pick<Models, "getAvailableOfType" | "getModelsOfType" | "classify">;
type Preference = { classifier_provider?: string; classifier_model?: string };

export async function availableClassifiers(runtime: Runtime, goCredential?: AgentCredential) {
  const models = [...(await runtime.getAvailableOfType("classifier"))];
  const key = goCredential?.type === "api_key" ? goCredential.key || goCredential.env?.OPENCODE_API_KEY : undefined;
  if (key)
    for (const model of runtime.getModelsOfType("classifier", "opencode")) {
      if (!models.some((entry) => entry.provider === model.provider && entry.id === model.id)) models.push(model);
    }
  return models;
}

// Only the resolved configured classifier reaches the sandbox; no auth, headers or URLs.
export async function createClassifierRegistry(
  runtime: Runtime,
  preference: Preference,
  budget: ClassifierBudget,
  goCredential?: AgentCredential,
  audit?: (entry: unknown) => void,
) {
  const available = await availableClassifiers(runtime, goCredential);
  const explicit = Boolean(preference.classifier_provider || preference.classifier_model);
  const selected = explicit
    ? available.find(
        (model) => model.provider === preference.classifier_provider && model.id === preference.classifier_model,
      )
    : available.find((model) => model.id === "jev-1.13-free") || available[0];
  const info = selected
    ? {
        type: "classifier" as const,
        provider: selected.provider,
        id: selected.id,
        name: selected.name,
        api: selected.api,
        input: selected.input,
        contextWindow: selected.contextWindow,
        cost: selected.cost,
      }
    : undefined;
  const visible = (type: string, provider?: string) =>
    type === "classifier" && info && (!provider || provider === info.provider) ? [info] : [];
  return {
    getModelsOfType: visible,
    getAvailableOfType: async (type: string, provider?: string) => visible(type, provider),
    getModelOfType: (type: string, provider: string, id: string) =>
      visible(type, provider).find((model) => model.id === id),
    generateImages: async () => {
      throw new Error("Doot codemode supports classification only, not image generation");
    },
    classify: async (
      model: ClassifierModel<ClassifierApi>,
      context: ClassifierContext,
      options: { signal?: AbortSignal } = {},
    ) => {
      if (!selected)
        throw new Error(
          explicit
            ? "The selected classification model is unavailable. Connect its provider or choose another in Settings → Classification."
            : "No classification model is available. Connect a provider in Settings → Classification.",
        );
      if (model.provider !== selected.provider || model.id !== selected.id)
        throw new Error("Use the configured classification model");
      options.signal?.throwIfAborted();
      const questionCount = Object.keys(context.questions).length;
      if (questionCount < 1 || questionCount > CLASSIFIER_LIMITS.questions)
        throw new Error("Ask between one and twelve classifier questions per call");
      const inputChars = JSON.stringify(context).length;
      if (inputChars > CLASSIFIER_LIMITS.inputChars)
        throw new Error("Classifier input exceeds 32000 characters; split the evidence into smaller batches");
      if (budget.calls >= CLASSIFIER_LIMITS.calls || budget.inputChars + inputChars > CLASSIFIER_LIMITS.runChars)
        throw new Error("Classification run budget exceeded");
      if (budget.running >= CLASSIFIER_LIMITS.concurrent)
        throw new Error("Classification permits at most four simultaneous calls");
      // Reserve estimated input/output cost before requests race; reported usage replaces it.
      const inputBytes = Buffer.byteLength(JSON.stringify(context), "utf8");
      const reservedCost =
        (inputBytes * selected.cost.input + (inputBytes * 2 + questionCount * 512) * selected.cost.output) / 1_000_000;
      if (budget.cost + reservedCost > CLASSIFIER_LIMITS.cost) throw new Error("Classification cost budget exceeded");
      budget.calls++;
      budget.inputChars += inputChars;
      budget.cost += reservedCost;
      budget.running++;
      const started = performance.now();
      try {
        const native = await runtime.getAvailableOfType("classifier", selected.provider, { signal: options.signal });
        const goKey =
          goCredential?.type === "api_key" ? goCredential.key || goCredential.env?.OPENCODE_API_KEY : undefined;
        const sharedKey =
          selected.provider === "opencode" && !native.some((entry) => entry.id === selected.id) ? goKey : undefined;
        const result = await runtime.classify(selected, context, {
          signal: options.signal,
          timeoutMs: CLASSIFIER_LIMITS.timeoutMs,
          maxRetries: 0,
          ...(sharedKey ? { apiKey: sharedKey } : {}),
        });
        budget.cost = Math.max(0, budget.cost - reservedCost + (result.usage?.cost.total ?? reservedCost));
        audit?.({
          provider: selected.provider,
          model: selected.id,
          questions: context.questions,
          answers: result.answers,
          stopReason: result.stopReason,
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
          durationMs: Math.round(performance.now() - started),
          inputChars,
          stateHash: createHash("sha256").update(JSON.stringify(context.state)).digest("hex"),
        });
        return result;
      } finally {
        budget.running--;
      }
    },
  };
}
