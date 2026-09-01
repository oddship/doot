import type { ApiRouteHandler } from "@/lib/api/context";
import { confirmedBody, RouteError, requestBody } from "@/lib/api/context";
import { startHistory } from "@/lib/history";
import { sanitizeMessageHtml } from "@/lib/mail";
import { emitBackground, store } from "@/lib/store";
import { getSyncJob, startSync } from "@/lib/sync";

const ACTIONS = new Set(["archive", "move", "delete"]);

async function createProposal(request: Request, manual: boolean) {
  const value = await requestBody(request);
  if (!ACTIONS.has(value.action))
    throw new RouteError(manual ? "Invalid mailbox action" : "Invalid generated mailbox action", 400);
  const proposal = await store<any>([
    "propose",
    value.action,
    JSON.stringify(value.items),
    "--reason",
    String(value.reason || (manual ? "Manually selected in Inbox" : "")),
  ]);
  emitBackground({ type: "proposal.created", proposal });
  startHistory({
    kind: "action",
    title: `Created ${manual ? "manual " : ""}${proposal.action} proposal`,
    status: "ready",
    event_type: "proposal_created",
    content: `${proposal.items?.length || value.items?.length || 0} messages await review.`,
    metadata: { proposal_id: proposal.id, proposal },
  });
  return Response.json(proposal, { status: 201 });
}

export const handleMailRoutes: ApiRouteHandler = async ({ request, path, key, method, url }) => {
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
        "--focus",
        url.searchParams.get("focus") || "",
        "--focus-folder",
        url.searchParams.get("focus_folder") || "",
      ]),
    );
  if (key === "message" && method === "GET") {
    const message = await store<any>([
      "read",
      url.searchParams.get("account") || "",
      url.searchParams.get("uid") || "",
      url.searchParams.get("folder") || "",
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
  if (key === "proposals" && method === "POST") return createProposal(request, false);
  if (key === "manual-proposals" && method === "POST") return createProposal(request, true);
  if (path[0] === "proposals" && path[1] && method === "GET")
    return Response.json({ proposal: await store(["action-get", path[1]]) });
  if (key === "apply" && method === "POST") {
    const value = await confirmedBody(request);
    const result = await store<any>(["apply", String(value.id)]);
    startHistory({
      kind: "action",
      title: `Applied mailbox proposal ${value.id}`,
      status: result.status === "applied" ? "complete" : "error",
      event_type: "proposal_applied",
      content: `Mailbox action finished with status ${result.status}.`,
      metadata: { proposal_id: value.id, result },
      error: result.status === "applied" ? undefined : result.status,
    });
    emitBackground({ type: "proposal.updated", proposal: result });
    emitBackground({ type: "cache.refresh", resource: "messages", items: result.results || [] });
    return Response.json(result);
  }
  return null;
};
