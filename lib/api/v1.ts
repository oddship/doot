import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { type ApiRouteHandler, assertTrustedRequest, errorResponse, RouteError, requestBody } from "@/lib/api/context";
import { apiOpenApiDocument, V1_OPERATIONS } from "@/lib/api/v1-contract";

function responseHeaders(response: Response) {
  response.headers.set("X-Doot-API-Version", "1");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function handleVersionedApi(request: Request, path: string[], legacyHandlers: ApiRouteHandler[]) {
  try {
    assertTrustedRequest(request);
    const parameters: Record<string, string> = {};
    const matches = V1_OPERATIONS.filter((operation) => {
      const parts = operation.path ? operation.path.split("/") : [];
      return parts.length === path.length && parts.every((part, i) => part.startsWith("{") || part === path[i]);
    });
    if (!matches.length) throw new RouteError("API operation not found", 404);
    const operation = matches.find((item) => item.method === request.method);
    if (!operation) {
      const response = errorResponse("Method not allowed", 405);
      response.headers.set("Allow", matches.map((item) => item.method).join(", "));
      return responseHeaders(response);
    }
    operation.path.split("/").forEach((part, i) => {
      if (part.startsWith("{")) parameters[part.slice(1, -1)] = path[i];
    });
    for (const [name, value] of Object.entries(parameters)) {
      if (
        !value ||
        value.length > 500 ||
        (name === "id" && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))))
      )
        throw new RouteError("Invalid path parameter", 400);
    }
    const url = new URL(request.url);
    if (new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length)
      throw new RouteError("Duplicate query parameters are not supported", 400);
    if (operation.query) {
      const query = operation.query.parse(Object.fromEntries(url.searchParams)) as Record<string, unknown>;
      for (const [name, value] of Object.entries(query))
        if (value !== undefined) url.searchParams.set(name, String(value));
      // Legacy handlers read query parameters from context.url.
    } else if (url.search) throw new RouteError("This operation has no query parameters", 400);
    let value: any;
    let forwarded = request;
    if (operation.body) {
      value = operation.body.parse(await requestBody(request.clone()));
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      forwarded = new Request(request.url, { method: request.method, headers, body: JSON.stringify(value) });
    }
    if (operation.custom === "index")
      return responseHeaders(
        Response.json({
          version: "1",
          openapi: "/api/v1/openapi.json",
          operations: V1_OPERATIONS.map(({ method, path, summary, confirmed }) => ({
            method,
            path: `/api/v1${path ? `/${path}` : ""}`,
            summary,
            explicit_confirmation: Boolean(confirmed),
          })),
        }),
      );
    if (operation.custom === "openapi") return responseHeaders(Response.json(apiOpenApiDocument()));
    if (operation.custom) {
      const result = await customOperation(operation.custom, parameters, url, value);
      return responseHeaders(Response.json(result, { status: operation.status || 200 }));
    }
    const context = { request: forwarded, path, key: path.join("/"), method: request.method, url };
    for (const handler of legacyHandlers) {
      const response = await handler(context);
      if (response) return responseHeaders(response);
    }
    throw new RouteError("API operation is not implemented", 501);
  } catch (error) {
    if (error instanceof ZodError)
      return responseHeaders(
        errorResponse(
          `Invalid request: ${error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ")}`,
          400,
        ),
      );
    const missing = error instanceof Error && /(?:not found|unknown (?:account|rule))$/i.test(error.message);
    const conflict =
      error instanceof Error &&
      /already has a saved (?:decision|turn)|mailbox changed|missing or not pending/i.test(error.message);
    return responseHeaders(
      errorResponse(error, error instanceof RouteError ? error.status : missing ? 404 : conflict ? 409 : 500),
    );
  }
}

async function customOperation(kind: string, params: Record<string, string>, url: URL, value: any) {
  const state = await import("@/lib/api/v1-state");
  const { db, json } = await import("@/lib/database");
  switch (kind) {
    case "account": {
      const { store } = await import("@/lib/store");
      const result = await store<any>(["accounts"]);
      const account = result.accounts.find((item: any) => item.name === params.account);
      if (!account) throw new RouteError("Account not found", 404);
      return { account };
    }
    case "rule": {
      const { store } = await import("@/lib/store");
      return store(["rule-get", params.id]);
    }
    case "sync": {
      const { startSync } = await import("@/lib/sync");
      const { getBackgroundJob } = await import("@/lib/background-jobs");
      const sync = await startSync();
      return { job: getBackgroundJob(sync.id!), sync, links: { job: `/api/v1/jobs/${sync.id}` } };
    }
    case "events":
      return state.eventPage(params.sessionId, url);
    case "approvals":
      return state.bodyApprovals(params.sessionId, url);
    case "reviews":
      return state.reviews(params.sessionId, url);
    case "review": {
      state.requireSession(params.sessionId);
      const { reviewProgress } = await import("@/lib/body-review");
      try {
        return reviewProgress(
          params.sessionId,
          params.reviewId,
          Number(url.searchParams.get("offset") || 0),
          Number(url.searchParams.get("limit") || 20),
        );
      } catch (error) {
        throw new RouteError((error as Error).message, /bounds|page/.test((error as Error).message) ? 400 : 404);
      }
    }
    case "artifacts":
      return state.artifacts(url);
    case "artifact": {
      const { store } = await import("@/lib/store");
      return { artifact: await store(["artifact-get", params.id]) };
    }
    case "artifact_create": {
      const { store } = await import("@/lib/store");
      return { artifact: await store(["artifact-save", JSON.stringify(value)]) };
    }
    case "proposals":
      return state.proposals(url);
    case "verification":
      return state.proposalVerification(Number(params.id), url);
    case "approve": {
      const { approveProposal } = await import("@/lib/background-jobs");
      const job = approveProposal(Number(params.id));
      return {
        job,
        links: { job: `/api/v1/jobs/${job.id}`, verification: `/api/v1/proposals/${params.id}/verification` },
      };
    }
    case "turn": {
      const { enqueueAgentTurn } = await import("@/lib/agent-jobs");
      const { commandId, ...input } = value;
      const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const key = `api-turn:${commandId}`;
      const job = db
        .transaction(() => {
          const old = db.prepare("SELECT value_json FROM app_state WHERE key=?").get(key) as any;
          if (old && json<any>(old.value_json, {}).fingerprint !== fingerprint)
            throw new RouteError("commandId already belongs to different turn input", 409);
          // Do not attach a new API idempotency key to a legacy/UI command whose
          // input fingerprint was never recorded by this interface.
          if (!old && db.prepare("SELECT 1 FROM background_jobs WHERE dedupe_key=?").get(`agent:${commandId}`))
            throw new RouteError("commandId is already in use outside this API", 409);
          const result = enqueueAgentTurn(input, commandId);
          if (!old)
            db.prepare("INSERT INTO app_state(key,value_json) VALUES(?,?)").run(key, JSON.stringify({ fingerprint }));
          return result;
        })
        .immediate();
      const sessionId = job.source.session_id;
      return {
        job,
        session_id: sessionId,
        links: {
          job: `/api/v1/jobs/${job.id}`,
          session: `/api/v1/agent/sessions/${sessionId}`,
          events: `/api/v1/agent/sessions/${sessionId}/events`,
          body_approvals: `/api/v1/agent/sessions/${sessionId}/body-approvals`,
          reviews: `/api/v1/agent/sessions/${sessionId}/reviews`,
        },
      };
    }
    default:
      throw new RouteError("Unknown operation", 501);
  }
}
