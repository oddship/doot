import type { ApiRouteHandler } from "@/lib/api/context";
import { confirmedBody, RouteError, requestBody } from "@/lib/api/context";
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
    const result = await store<any>(["rule-propose", id]);
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
    const prepared = await store<any>(["rule-propose", id, "--expected", confirmation.expected_rule]);
    emitBackground({ type: "proposal.created", proposal: prepared.proposal });
    const applied = await store<any>(["apply", String(prepared.proposal.id)]);
    startHistory({
      kind: "flow",
      title: `Ran Flow · ${prepared.rule.name}`,
      status: applied.status === "applied" ? "complete" : "error",
      event_type: "flow_run_applied",
      content: `${prepared.proposed} of ${prepared.matched} matches processed · ${applied.status}`,
      metadata: {
        flow_id: prepared.rule.id,
        proposal_id: prepared.proposal.id,
        matched: prepared.matched,
        proposed: prepared.proposed,
        applied,
      },
      error: applied.status === "applied" ? undefined : applied.status,
    });
    emitBackground({ type: "proposal.updated", proposal: applied });
    emitBackground({ type: "cache.refresh", resource: "messages", items: applied.results || [] });
    return Response.json({ ...prepared, applied });
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
