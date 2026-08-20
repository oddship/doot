import { z } from "zod";

const short = z.string().trim().min(1).max(240);
const text = z.string().trim().min(1).max(4_000);
const inboxQuery = z
  .string()
  .max(200)
  .describe(
    'Inbox search using plain sender/subject terms and the supported operators from:, sender:, subject:, and domain:. Quote multi-word operator values, for example from:notifications@github.com "Run failed" or subject:"Payment received".',
  );

const workspaceActionIntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("open_message"), account: short, uid: z.string().regex(/^\d+$/) }).strict(),
  z.object({ type: z.literal("filter_inbox"), account: short.optional(), query: inboxQuery.optional() }).strict(),
  z
    .object({
      type: z.literal("create_proposal"),
      action: z.enum(["archive", "move", "delete"]),
      reason: text,
      items: z
        .array(z.object({ account: short, uid: z.string().regex(/^\d+$/), folder: short.optional() }).strict())
        .min(1)
        .max(40),
    })
    .strict(),
  z.object({ type: z.literal("open_artifact"), artifactId: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("open_rule"), ruleId: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("open_flow"), flowId: z.number().int().positive() }).strict(),
]);

const action = z.object({ label: short, intent: workspaceActionIntentSchema }).strict();
const message = z
  .object({
    account: short,
    uid: z.string().regex(/^\d+$/),
    sender: short,
    subject: z.string().max(500),
    date: z.string().max(100).optional(),
    detail: z.string().max(500).optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(5).optional(),
  })
  .strict();

export type WorkspaceNode =
  | { type: "stack"; gap?: "sm" | "md" | "lg"; children: WorkspaceNode[] }
  | { type: "grid"; columns?: 2 | 3 | 4; children: WorkspaceNode[] }
  | { type: "heading"; text: string; level?: 2 | 3; description?: string }
  | { type: "metric"; label: string; value: string; detail?: string; tone?: "neutral" | "good" | "attention" }
  | { type: "message_group"; title: string; messages: z.infer<typeof message>[]; action?: z.infer<typeof action> }
  | { type: "table"; title?: string; columns: string[]; rows: string[][] }
  | { type: "chart"; title: string; kind: "bar" | "pie"; data: { label: string; value: number }[] }
  | { type: "sender_cluster"; sender: string; count: number; summary: string; action?: z.infer<typeof action> }
  | { type: "rule_suggestion"; title: string; description: string; action?: z.infer<typeof action> }
  | { type: "flow_suggestion"; title: string; description: string; action?: z.infer<typeof action> }
  | {
      type: "search_link";
      label: string;
      description?: string;
      account?: string;
      query?: string;
      count?: number;
      tags?: string[];
    }
  | { type: "note"; title?: string; body: string; tone?: "neutral" | "good" | "attention" }
  | { type: "action_group"; title?: string; actions: z.infer<typeof action>[] };

const workspaceNodeSchema: z.ZodType<WorkspaceNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("stack"),
        gap: z.enum(["sm", "md", "lg"]).optional(),
        children: z.array(workspaceNodeSchema).min(1).max(20),
      })
      .strict(),
    z
      .object({
        type: z.literal("grid"),
        columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
        children: z.array(workspaceNodeSchema).min(1).max(12),
      })
      .strict(),
    z
      .object({
        type: z.literal("heading"),
        text: short,
        level: z.union([z.literal(2), z.literal(3)]).optional(),
        description: text.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("metric"),
        label: short,
        value: short,
        detail: text.optional(),
        tone: z.enum(["neutral", "good", "attention"]).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("message_group"),
        title: short,
        messages: z.array(message).min(1).max(20),
        action: action.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("table"),
        title: short.optional(),
        columns: z.array(short).min(1).max(8),
        rows: z.array(z.array(z.string().max(500)).max(8)).max(30),
      })
      .strict(),
    z
      .object({
        type: z.literal("chart"),
        title: short,
        kind: z.enum(["bar", "pie"]),
        data: z
          .array(z.object({ label: short, value: z.number().finite().nonnegative() }).strict())
          .min(1)
          .max(20),
      })
      .strict(),
    z
      .object({
        type: z.literal("sender_cluster"),
        sender: short,
        count: z.number().int().nonnegative(),
        summary: text,
        action: action.optional(),
      })
      .strict(),
    z
      .object({ type: z.literal("rule_suggestion"), title: short, description: text, action: action.optional() })
      .strict(),
    z
      .object({ type: z.literal("flow_suggestion"), title: short, description: text, action: action.optional() })
      .strict(),
    z
      .object({
        type: z.literal("search_link"),
        label: short,
        description: text.optional(),
        account: short.optional(),
        query: inboxQuery.optional(),
        count: z.number().int().nonnegative().optional(),
        tags: z.array(z.string().trim().min(1).max(30)).max(5).optional(),
      })
      .strict()
      .refine((value) => Boolean(value.account || value.query), { message: "Search links need an account or query" }),
    z
      .object({
        type: z.literal("note"),
        title: short.optional(),
        body: text,
        tone: z.enum(["neutral", "good", "attention"]).optional(),
      })
      .strict(),
    z
      .object({ type: z.literal("action_group"), title: short.optional(), actions: z.array(action).min(1).max(10) })
      .strict(),
  ]),
);

export const generatedWorkspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: short,
    summary: text,
    root: workspaceNodeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    let count = 0;
    const visit = (node: WorkspaceNode, depth: number) => {
      count += 1;
      if (depth > 7) context.addIssue({ code: "custom", message: "Workspace is nested too deeply" });
      if (count > 120) context.addIssue({ code: "custom", message: "Workspace has too many components" });
      if (node.type === "stack" || node.type === "grid")
        node.children.forEach((child) => {
          visit(child, depth + 1);
        });
      if (node.type === "table" && node.rows.some((row) => row.length !== node.columns.length))
        context.addIssue({ code: "custom", message: "Table rows must match its columns" });
    };
    visit(value.root, 1);
  });

// The Agent sees the same exhaustive contract that the persistence and render
// boundaries enforce. Keeping this generated from Zod prevents prompt/schema
// drift and makes invalid component names fail before tool execution.
export const generatedWorkspaceJsonSchema = z.toJSONSchema(generatedWorkspaceSchema);

export type GeneratedWorkspace = z.infer<typeof generatedWorkspaceSchema>;
export type WorkspaceActionIntent = z.infer<typeof workspaceActionIntentSchema>;

export function parseWorkspace(value: unknown) {
  const encoded = JSON.stringify(value);
  if (encoded.length > 100_000) throw new Error("Workspace exceeds the 100 KB limit");
  return generatedWorkspaceSchema.parse(value);
}
