import { listModels, updateRuntimeKey } from "@/lib/agent-runtime";
import { sanitizeMessageHtml } from "@/lib/mail";
import { emitBackground, store } from "@/lib/store";
import { getSyncJob, startSync } from "@/lib/sync";
import { generatedWorkspaceSchema } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class RouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
function errorResponse(error: any, status = error instanceof RouteError ? error.status : 500) {
  return Response.json({ error: String(error?.message || error) }, { status });
}
async function body(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
async function confirmedBody(request: Request, message = "Explicit confirmation is required") {
  const value = await body(request);
  if (value.confirm !== true) throw new RouteError(message, 400);
  return value;
}

async function handler(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const key = path.join("/");
    const method = request.method;
    const url = new URL(request.url);
    if (key === "health" && method === "GET")
      return Response.json({ ok: true, runtime: "next+pi+imapflow", sqlite: true, read_preserving: true });
    if (key === "accounts" && method === "GET") return Response.json(await store(["accounts"]));
    if (key === "accounts" && method === "POST")
      return Response.json(await store(["account-upsert", JSON.stringify(await body(request))]), { status: 201 });
    if (path[0] === "accounts" && path.length >= 2) {
      const name = decodeURIComponent(path[1]);
      if (path[2] === "test" && method === "POST") return Response.json(await store(["account-test", name]));
      if (path[2] === "folders" && method === "GET") return Response.json(await store(["account-folders", name]));
      if (path[2] === "folders" && ["POST", "PUT", "DELETE"].includes(method)) {
        const value = await confirmedBody(request, "Explicit confirmation is required for every IMAP folder write");
        const action = method === "POST" ? "create" : method === "PUT" ? "rename" : "delete";
        const result = await store<any>([
          "folder-mutate",
          name,
          JSON.stringify({ action, path: value.path, ...(action === "rename" ? { new_path: value.new_path } : {}) }),
        ]);
        emitBackground({ type: "cache.refresh", resource: "folders", account: name });
        if (action !== "create") emitBackground({ type: "cache.refresh", resource: "rules" });
        return Response.json(result, { status: action === "create" ? 201 : 200 });
      }
      if (method === "PUT")
        return Response.json(await store(["account-upsert", JSON.stringify({ ...(await body(request)), name })]));
      if (method === "DELETE") {
        await confirmedBody(request);
        return Response.json(await store(["account-delete", name]));
      }
    }
    if (key === "dashboard" && method === "GET") return Response.json(await store(["dashboard"]));
    if (key === "artifacts" && method === "GET") return Response.json(await store(["artifact-list"]));
    if (key === "agent/sessions" && method === "GET") return Response.json(await store(["session-list"]));
    if (path[0] === "agent" && path[1] === "sessions" && path[2] && method === "GET")
      return Response.json(await store(["session-get", path[2]]));
    if (key === "agent/models" && method === "GET") return Response.json({ models: await listModels() });
    if (key === "agent/credentials" && method === "GET") return Response.json(await store(["agent-keys"]));
    if (key === "agent/credentials" && method === "PUT") {
      const value = await body(request);
      const provider = String(value.provider || "");
      const apiKey = String(value.api_key || "");
      const saved = await store(["agent-key-set", provider, apiKey]);
      await updateRuntimeKey(provider, apiKey);
      return Response.json(saved);
    }
    if (key === "agent/memory" && method === "GET") {
      const namespace = url.searchParams.get("namespace");
      return Response.json(
        namespace
          ? await store(["memory-list", namespace, "--prefix", url.searchParams.get("prefix") || "", "--limit", "100"])
          : await store(["memory-namespaces"]),
      );
    }
    if (key === "agent/memory" && method === "PUT") {
      const value = await body(request);
      return Response.json(
        await store([
          "memory-set",
          String(value.namespace || ""),
          String(value.key || ""),
          JSON.stringify(value.value),
        ]),
      );
    }
    if (key === "agent/memory" && method === "DELETE") {
      const value = await confirmedBody(request);
      return Response.json(await store(["memory-delete", String(value.namespace || ""), String(value.key || "")]));
    }
    if (key === "settings" && method === "GET") return Response.json(await store(["settings-get"]));
    if (key === "settings" && method === "PUT")
      return Response.json(await store(["settings-set", JSON.stringify(await body(request))]));
    if (key === "rules" && method === "GET") return Response.json(await store(["rule-list"]));
    if (key === "rules" && method === "POST")
      return Response.json(
        await store(["rule-upsert", JSON.stringify({ ...(await body(request)), source: "manual" })]),
        { status: 201 },
      );
    if (path[0] === "rules" && path[1]) {
      const id = path[1];
      if (path[2] === "preview" && method === "GET")
        return Response.json(
          await store([
            "rule-preview",
            id,
            "--offset",
            url.searchParams.get("offset") || "0",
            "--limit",
            url.searchParams.get("limit") || "25",
          ]),
        );
      if (path[2] === "propose" && method === "POST") {
        const result = await store<any>(["rule-propose", id]);
        emitBackground({ type: "proposal.created", proposal: result.proposal });
        return Response.json(result, { status: 201 });
      }
      if (path[2] === "run" && method === "POST") {
        await confirmedBody(request, "Explicit confirmation is required to run a rule");
        const prepared = await store<any>(["rule-propose", id]);
        emitBackground({ type: "proposal.created", proposal: prepared.proposal });
        const applied = await store<any>(["apply", String(prepared.proposal.id)]);
        emitBackground({ type: "proposal.updated", proposal: applied });
        return Response.json({ ...prepared, applied });
      }
      if (method === "PUT")
        return Response.json(
          await store(["rule-upsert", JSON.stringify({ ...(await body(request)), id: Number(id) })]),
        );
      if (method === "DELETE") {
        await confirmedBody(request);
        return Response.json(await store(["rule-delete", id]));
      }
    }
    if (key === "messages" && method === "GET")
      return Response.json(
        await store([
          "list",
          "--account",
          url.searchParams.get("account") || "all",
          "--query",
          url.searchParams.get("query") || "",
          "--offset",
          url.searchParams.get("offset") || "0",
          "--limit",
          url.searchParams.get("limit") || "25",
        ]),
      );
    if (key === "message" && method === "GET") {
      const message = await store<any>([
        "read",
        url.searchParams.get("account") || "",
        url.searchParams.get("uid") || "",
      ]);
      const { settings } = await store<any>(["settings-get"]);
      const hasRemoteImages = /<img\b[^>]*\bsrc\s*=\s*["']?https?:/i.test(message.body_html || "");
      const allowRemoteImages = Boolean(settings.allow_remote_images) || url.searchParams.get("remote") === "1";
      message.body_html_sanitized = message.body_html ? sanitizeMessageHtml(message.body_html, allowRemoteImages) : "";
      message.has_remote_images = hasRemoteImages;
      message.remote_images_allowed = allowRemoteImages;
      delete message.body_html;
      return Response.json(message);
    }
    if (key === "sync" && method === "GET") return Response.json(getSyncJob());
    if (key === "sync" && method === "POST") return Response.json(await startSync(), { status: 202 });
    if (key === "proposals" && method === "POST") {
      const value = await body(request);
      if (!(["archive", "move", "delete"] as unknown[]).includes(value.action))
        return errorResponse("Invalid generated mailbox action", 400);
      const proposal = await store<any>([
        "propose",
        value.action,
        JSON.stringify(value.items),
        "--reason",
        String(value.reason || ""),
      ]);
      emitBackground({ type: "proposal.created", proposal });
      return Response.json(proposal, { status: 201 });
    }
    if (key === "manual-proposals" && method === "POST") {
      const value = await body(request);
      if (!(["archive", "move", "delete"] as unknown[]).includes(value.action))
        return errorResponse("Invalid mailbox action", 400);
      const proposal = await store<any>([
        "propose",
        value.action,
        JSON.stringify(value.items),
        "--reason",
        String(value.reason || "Manually selected in Inbox"),
      ]);
      emitBackground({ type: "proposal.created", proposal });
      return Response.json(proposal, { status: 201 });
    }
    if (key === "apply" && method === "POST") {
      const value = await confirmedBody(request);
      const result = await store<any>(["apply", String(value.id)]);
      emitBackground({ type: "proposal.updated", proposal: result });
      return Response.json(result);
    }
    if (path[0] === "workspaces" && method === "GET") {
      const id = path[1] || "latest";
      const result = await store<any>(["workspace-get", id]);
      if (result.workspace.schema_version === 1) {
        const parsed = generatedWorkspaceSchema.safeParse(result.workspace.spec);
        if (!parsed.success)
          return errorResponse("Saved workspace is not compatible with this application version", 422);
        result.workspace.spec = parsed.data;
        result.workspace.compatible = true;
      } else result.workspace.compatible = false;
      return Response.json(result);
    }
    return errorResponse("Not found", 404);
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
