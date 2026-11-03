import type { ApiRouteHandler } from "@/lib/api/context";
import { confirmedBody, RouteError, requestBody } from "@/lib/api/context";
import { approveFlowRun } from "@/lib/background-jobs";
import { startHistory } from "@/lib/history";
import { mailActionLabel } from "@/lib/mail-actions";
import { emitBackground, store } from "@/lib/store";

export const handleFlowRoutes: ApiRouteHandler = async ({ request, path, key, method, url }) => {
  if (key === "rules" && method === "GET") return Response.json(await store(["rule-list"]));
  if (key === "rules" && method === "POST") {
    const result = await store<any>([
      "rule-upsert",
      JSON.stringify({ ...(await requestBody(request)), source: "manual" }),
    ]);
    startHistory({
      kind: "flow",
      title: `Created Flow · ${result.rule.name}`,
      event_type: "flow_created",
      content: `${result.rule.query} → ${mailActionLabel(result.rule)}`,
      metadata: { flow_id: result.rule.id, rule: result.rule },
    });
    return Response.json(result, { status: 201 });
  }
  if (path[0] !== "rules" || !path[1]) return null;

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
    const body = await requestBody(request);
    const result = await store<any>(["rule-propose", id, "--expected", String(body.expected_rule || "")]);
    startHistory({
      kind: "flow",
      title: `Prepared Flow proposal · ${result.rule.name}`,
      status: "ready",
      event_type: "flow_proposal_created",
      content: `${result.proposed} of ${result.matched} matches prepared; no mailbox change was applied.`,
      metadata: { flow_id: result.rule.id, proposal_id: result.proposal.id },
    });
    emitBackground({ type: "proposal.created", proposal: result.proposal });
    return Response.json(result, { status: 201 });
  }
  if (path[2] === "run" && method === "POST") {
    const confirmation = await confirmedBody(request, "Explicit confirmation is required to run a rule");
    if (typeof confirmation.expected_rule !== "string" || !confirmation.expected_rule)
      throw new RouteError("Preview and confirm the complete Flow action sequence before running", 400);
    if (typeof confirmation.command_id !== "string" || !confirmation.command_id)
      throw new RouteError("A stable command ID is required", 400);
    const job = approveFlowRun(Number(id), confirmation.expected_rule, confirmation.command_id);
    return Response.json({ job }, { status: 202 });
  }
  if (method === "PUT") {
    const before = await store<any>(["rule-get", id]);
    const result = await store<any>([
      "rule-upsert",
      JSON.stringify({ ...(await requestBody(request)), id: Number(id) }),
    ]);
    const eventType =
      before.rule.enabled !== result.rule.enabled
        ? result.rule.enabled
          ? "flow_activated"
          : "flow_paused"
        : "flow_updated";
    startHistory({
      kind: "flow",
      title: `${eventType === "flow_activated" ? "Activated" : eventType === "flow_paused" ? "Paused" : "Updated"} Flow · ${result.rule.name}`,
      event_type: eventType,
      content: `${result.rule.query} → ${mailActionLabel(result.rule)}`,
      metadata: { flow_id: result.rule.id, before: before.rule, after: result.rule },
    });
    return Response.json(result);
  }
  if (method === "DELETE") {
    await confirmedBody(request);
    const before = await store<any>(["rule-get", id]);
    const result = await store(["rule-delete", id]);
    startHistory({
      kind: "flow",
      title: `Deleted Flow · ${before.rule.name}`,
      event_type: "flow_deleted",
      content: "The saved Flow was removed; no email was changed.",
      metadata: { flow_id: Number(id), rule: before.rule },
    });
    return Response.json(result);
  }
  return null;
};
