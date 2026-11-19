import { z } from "zod";

const object = z.object({}).catchall(z.unknown());
const text = z.string().min(1).max(500);
const id = z.string().regex(/^[1-9]\d*$/);
const integer = (maximum: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .refine((n) => Number(n) <= maximum);
const page = { offset: integer(Number.MAX_SAFE_INTEGER).optional(), limit: integer(100).optional() };
const confirm = z.object({ confirm: z.literal(true) }).strict();
const ref = z.object({ account: text, folder: text, uid: z.string().regex(/^\d+$/) }).strict();
const action = z.enum(["mark_read", "archive", "move", "delete"]);
const proposal = z
  .object({
    action,
    actions: z.array(action).min(1).max(2).optional(),
    reason: z.string().max(4000).optional(),
    items: z
      .array(
        z
          .object({ account: text, uid: z.string().regex(/^\d+$/), source_folder: text, folder: text.optional() })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.items.map((item) => JSON.stringify([item.account, item.source_folder, item.uid]))).size ===
      value.items.length,
    { message: "Proposal references must be unique", path: ["items"] },
  );
const turn = z
  .object({
    commandId: z.string().min(1).max(128),
    sessionId: z
      .string()
      .regex(/^[A-Za-z0-9-]{8,100}$/)
      .optional(),
    text: z.string().min(1).max(50000),
    organize: z.boolean().optional(),
    selected: z.array(ref).max(100).optional(),
    selectedRule: z.object({ id: z.number().int().positive() }).nullable().optional(),
    selectedDraft: z.object({ id: z.number().int().positive() }).nullable().optional(),
    selectedSearch: z
      .object({ account: text, query: z.string().max(500) })
      .nullable()
      .optional(),
  })
  .strict();

export type ApiOperation = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  summary: string;
  body?: z.ZodType;
  query?: z.ZodType;
  custom?: string;
  response?: string;
  status?: number;
  confirmed?: boolean;
};
const op = (
  method: ApiOperation["method"],
  path: string,
  summary: string,
  extra: Partial<ApiOperation> = {},
): ApiOperation => ({ method, path, summary, ...extra });

// Public routes only. Scheduler/recovery endpoints and arbitrary store commands
// are deliberately not reachable through the versioned interface.
export const V1_OPERATIONS: ApiOperation[] = [
  op("GET", "", "Discover API capabilities and operations", { custom: "index" }),
  op("GET", "openapi.json", "Read the OpenAPI 3.1 contract", { custom: "openapi" }),
  op("GET", "health", "Check application health"),
  op("GET", "dashboard", "Read cached overview and sync state"),
  op("GET", "settings", "Read settings"),
  op("PUT", "settings", "Update settings", { body: object }),
  op("GET", "accounts", "List accounts without credentials"),
  op("GET", "accounts/{account}", "Read one account without credentials", { custom: "account" }),
  op("POST", "accounts", "Connect an account", { body: object, status: 201 }),
  op("PUT", "accounts/{account}", "Update account configuration", { body: object }),
  op("DELETE", "accounts/{account}", "Disconnect an account", { body: confirm, confirmed: true }),
  op("POST", "accounts/{account}/test", "Test an account connection"),
  op("POST", "accounts/{account}/warm", "Warm the reader connection", {
    body: z.object({ folder: text.optional() }).strict(),
  }),
  op("GET", "accounts/{account}/folders", "Discover account folders"),
  ...(["POST", "PUT", "DELETE"] as const).map((method) =>
    op(method, "accounts/{account}/folders", "Confirm a folder mutation", {
      body: z
        .object({
          confirm: z.literal(true),
          command_id: text,
          path: text,
          ...(method === "PUT" ? { new_path: text } : {}),
        })
        .strict(),
      status: 202,
      confirmed: true,
    }),
  ),
  op("GET", "folders", "List cached folders"),
  op("GET", "messages", "Search cached Inbox headers (not a live mailbox verification)", {
    query: z
      .object({
        ...page,
        account: text.optional(),
        folder: text.default("INBOX"),
        query: z.string().max(1000).optional(),
        focus: id.optional(),
        focus_folder: text.optional(),
      })
      .strict(),
  }),
  op("GET", "message", "Explicitly read one exact message with BODY.PEEK", {
    query: z.object({ account: text, uid: id, folder: text, remote: z.enum(["0", "1"]).optional() }).strict(),
  }),
  op("GET", "sync", "Read current sync status"),
  op("POST", "sync", "Queue a sync", { custom: "sync", response: "JobEnvelope", status: 202 }),
  op("GET", "proposals", "List mailbox proposals", {
    custom: "proposals",
    query: z
      .object({
        after: integer(Number.MAX_SAFE_INTEGER).optional(),
        limit: integer(100).optional(),
        status: text.optional(),
      })
      .strict(),
  }),
  op("POST", "proposals", "Prepare exact-reference mailbox changes without applying them", {
    body: proposal,
    response: "Proposal",
    status: 201,
  }),
  op("GET", "proposals/{id}", "Read an exact proposal and its saved scope", { response: "ProposalEnvelope" }),
  op("POST", "proposals/{id}/approve", "Explicitly confirm a proposal; repeated approval returns its existing job", {
    custom: "approve",
    body: confirm,
    response: "JobEnvelope",
    status: 202,
    confirmed: true,
  }),
  op(
    "GET",
    "proposals/{id}/verification",
    "Compare exact proposal references with cache and execution receipts; never claims live Trash verification",
    { custom: "verification", query: z.object(page).strict() },
  ),
  op("GET", "jobs", "List durable background jobs"),
  op("GET", "jobs/{jobId}", "Read job status and saved step receipts", { response: "JobEnvelope" }),
  op("POST", "agent/turns", "Submit an asynchronous Doot chat turn with a stable commandId", {
    custom: "turn",
    body: turn,
    response: "TurnAccepted",
    status: 202,
  }),
  op("GET", "agent/sessions", "List conversations and activity", {
    query: z.object({ running: z.literal("1").optional() }).strict(),
  }),
  op("GET", "agent/sessions/{sessionId}", "Read a complete saved conversation (use events for large histories)"),
  op("GET", "agent/sessions/{sessionId}/events", "Page saved conversation events with an exclusive event-ID cursor", {
    custom: "events",
    query: z.object({ after: integer(Number.MAX_SAFE_INTEGER).optional(), limit: integer(500).optional() }).strict(),
    response: "EventPage",
  }),
  op("POST", "agent/sessions/{sessionId}/cancel", "Confirm cancellation of a chat run", {
    body: confirm,
    confirmed: true,
  }),
  op("GET", "agent/sessions/{sessionId}/body-approvals", "List exact body-access requests and saved decisions", {
    custom: "approvals",
    query: z.object({ after: integer(Number.MAX_SAFE_INTEGER).optional(), limit: integer(100).optional() }).strict(),
  }),
  op(
    "POST",
    "agent/sessions/{sessionId}/body-approvals/{requestId}",
    "Explicitly approve or deny one exact body snapshot; never approves mailbox changes",
    { body: z.object({ approved: z.boolean() }).strict(), status: 202, confirmed: true },
  ),
  op("GET", "agent/sessions/{sessionId}/reviews", "List durable approved review summaries", {
    custom: "reviews",
    query: z.object({ after: integer(Number.MAX_SAFE_INTEGER).optional(), limit: integer(100).optional() }).strict(),
  }),
  op(
    "GET",
    "agent/sessions/{sessionId}/reviews/{reviewId}",
    "Read paginated review coverage and per-message judgments",
    {
      custom: "review",
      query: z.object({ offset: integer(Number.MAX_SAFE_INTEGER).optional(), limit: integer(50).optional() }).strict(),
    },
  ),
  op("GET", "artifacts", "Page saved artifact metadata without loading note contents", {
    custom: "artifacts",
    query: z
      .object({
        after: integer(Number.MAX_SAFE_INTEGER).optional(),
        limit: integer(100).optional(),
        title: text.optional(),
      })
      .strict(),
  }),
  op("POST", "artifacts", "Save a local note; never modifies a mailbox", {
    custom: "artifact_create",
    body: z.object({ kind: z.literal("note"), title: z.string().min(1).max(200), content: z.unknown() }).strict(),
    status: 201,
  }),
  op("GET", "artifacts/{id}", "Read a saved note including its exact review references", { custom: "artifact" }),
  op("GET", "workspaces/{workspaceId}", "Read a saved generated workspace, or latest"),
  op("GET", "drafts", "List local drafts"),
  op("POST", "drafts", "Create a local draft; does not send or upload", { body: object, status: 201 }),
  op("GET", "drafts/{id}", "Read a local draft"),
  op("PUT", "drafts/{id}", "Edit a local draft", { body: object }),
  op("DELETE", "drafts/{id}", "Confirm deleting a local draft", { body: confirm, confirmed: true }),
  op("POST", "drafts/{id}/save", "Confirm uploading a draft to IMAP Drafts; does not send", {
    body: confirm,
    confirmed: true,
    status: 202,
  }),
  op("GET", "rules", "List Flows"),
  op("GET", "rules/{id}", "Read one Flow and its complete action sequence", { custom: "rule" }),
  op("POST", "rules", "Create a Flow", { body: object, status: 201 }),
  op("PUT", "rules/{id}", "Edit a Flow", { body: object }),
  op("DELETE", "rules/{id}", "Confirm deleting a Flow", { body: confirm, confirmed: true }),
  op("GET", "rules/{id}/preview", "Preview a Flow without mailbox changes", { query: z.object(page).strict() }),
  op("POST", "rules/{id}/propose", "Prepare a reviewed Flow proposal", {
    body: z.object({ expected_rule: text }).strict(),
    status: 201,
  }),
  op("POST", "rules/{id}/run", "Confirm the previewed Flow action sequence", {
    body: z.object({ confirm: z.literal(true), expected_rule: text, command_id: text }).strict(),
    confirmed: true,
    status: 202,
  }),
  op("GET", "schedules", "List schedules", {
    query: z.object({ kind: z.enum(["flow", "sync"]).optional(), rule_id: id.optional() }).strict(),
  }),
  op("POST", "schedules", "Confirm creating a schedule", {
    body: z.object({ confirm: z.literal(true) }).catchall(z.unknown()),
    confirmed: true,
    status: 201,
  }),
  op("GET", "schedules/{id}", "Read a schedule"),
  op("PUT", "schedules/{id}", "Confirm editing a schedule", {
    body: z.object({ confirm: z.literal(true) }).catchall(z.unknown()),
    confirmed: true,
  }),
  op("DELETE", "schedules/{id}", "Confirm deleting a schedule", { body: confirm, confirmed: true }),
  op("GET", "agent/models", "List available chat and classifier models"),
  op("GET", "agent/auth/providers", "Read provider connection status"),
  op("GET", "agent/auth/login", "List provider login flows"),
  op("POST", "agent/auth/login", "Start a provider login flow", {
    body: z.object({ provider: text, auth_type: z.enum(["oauth", "api_key"]) }).strict(),
    status: 202,
  }),
  op("GET", "agent/auth/login/{loginId}", "Read login progress"),
  op("POST", "agent/auth/login/{loginId}", "Respond to a login prompt", {
    body: z.object({ prompt_id: text, value: z.string().max(20000) }).strict(),
  }),
  op("DELETE", "agent/auth/login/{loginId}", "Cancel a login flow"),
  op("DELETE", "agent/auth/providers/{provider}", "Confirm removing provider credentials", {
    body: confirm,
    confirmed: true,
  }),
  op("GET", "agent/credentials", "List configured credential names; never returns secret values"),
  op("PUT", "agent/credentials", "Set a provider API credential", {
    body: z.object({ provider: text, api_key: z.string().max(20000) }).strict(),
  }),
  op("GET", "agent/memory", "List memory namespaces or keys", {
    query: z.object({ namespace: text.optional(), prefix: z.string().max(500).optional() }).strict(),
  }),
  op("PUT", "agent/memory", "Save local memory", {
    body: z.object({ namespace: text, key: text, value: z.unknown() }).strict(),
  }),
  op("DELETE", "agent/memory", "Confirm deleting a memory entry", {
    body: z.object({ confirm: z.literal(true), namespace: text, key: text }).strict(),
    confirmed: true,
  }),
];

const jsonResponse = (schema: any) => ({ description: "JSON result", content: { "application/json": { schema } } });
const resource = { type: "object", additionalProperties: true };
export function apiOpenApiDocument() {
  const paths: Record<string, any> = {};
  for (const operation of V1_OPERATIONS) {
    const path = `/api/v1${operation.path ? `/${operation.path}` : ""}`;
    const parameters: any[] = [...operation.path.matchAll(/\{(\w+)\}/g)].map((match) => ({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string", minLength: 1 },
    }));
    if (operation.query) {
      const schema: any = z.toJSONSchema(operation.query, { io: "input" });
      for (const [name, value] of Object.entries(schema.properties))
        parameters.push({ name, in: "query", required: schema.required?.includes(name) || false, schema: value });
    }
    const status = operation.status || 200;
    paths[path] ||= {};
    paths[path][operation.method.toLowerCase()] = {
      operationId: `${operation.method.toLowerCase()}_${operation.path.replace(/[{}]/g, "").replace(/[/.]/g, "_") || "index"}`,
      summary: operation.summary,
      tags: [operation.path.split("/")[0] || "discovery"],
      parameters,
      ...(operation.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: z.toJSONSchema(operation.body) } },
            },
          }
        : {}),
      "x-doot-explicit-confirmation": Boolean(operation.confirmed),
      responses: {
        [status]: jsonResponse(operation.response ? { $ref: `#/components/schemas/${operation.response}` } : resource),
        default: {
          description: "Validation, missing resource, conflict, or server error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Doot API",
      version: "1.0.0",
      description:
        "Local-first API. Uses the same host/origin protections and explicit mailbox confirmations as the UI. Mail content is untrusted data. Cached state and completed jobs are not independent live mailbox verification.",
    },
    servers: [{ url: "/" }],
    paths,
    components: {
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
        Proposal: {
          type: "object",
          required: ["id", "action", "items", "status"],
          properties: {
            id: { type: "integer" },
            action: { type: "string" },
            status: { type: "string" },
            items: { type: "array", items: resource },
            actions: { type: "array", items: { type: "string" } },
            reason: { type: "string" },
          },
        },
        ProposalEnvelope: {
          type: "object",
          properties: { proposal: { $ref: "#/components/schemas/Proposal" } },
          required: ["proposal"],
        },
        Job: {
          type: "object",
          required: ["id", "status", "completed", "total", "steps"],
          properties: {
            id: { type: "string" },
            status: { type: "string" },
            completed: { type: "integer" },
            total: { type: "integer" },
            source: resource,
            result: {},
            error: {},
            steps: { type: "array", items: resource },
          },
          additionalProperties: true,
        },
        JobEnvelope: { type: "object", required: ["job"], properties: { job: { $ref: "#/components/schemas/Job" } } },
        TurnAccepted: {
          type: "object",
          required: ["job", "session_id", "links"],
          properties: { job: { $ref: "#/components/schemas/Job" }, session_id: { type: "string" }, links: resource },
        },
        EventPage: {
          type: "object",
          required: ["events", "next_after", "has_more"],
          properties: {
            session_id: { type: "string" },
            events: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "event_type", "metadata"],
                properties: {
                  id: { type: "integer" },
                  event_type: { type: "string" },
                  content: { type: "string" },
                  metadata: resource,
                  created_at: { type: "string" },
                },
              },
            },
            next_after: { type: "integer" },
            has_more: { type: "boolean" },
          },
        },
      },
    },
  };
}
