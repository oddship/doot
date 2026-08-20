import type { ApiRouteHandler } from "@/lib/api/context";
import { confirmedBody, RouteError } from "@/lib/api/context";
import { startHistory } from "@/lib/history";
import { deleteSchedule, getSchedule, listSchedules, saveSchedule } from "@/lib/schedules";
import { emitBackground } from "@/lib/store";

export const handleScheduleRoutes: ApiRouteHandler = async ({ request, path, key, method, url }) => {
  if (key === "schedules" && method === "GET")
    return Response.json(
      listSchedules({
        kind: url.searchParams.get("kind") || undefined,
        rule_id: Number(url.searchParams.get("rule_id")) || undefined,
      }),
    );
  if (key === "schedules" && method === "POST") {
    const value = await confirmedBody(request, "Explicit confirmation is required to create a schedule");
    const schedule = saveSchedule(value);
    startHistory({
      kind: "schedule",
      title: `Created ${schedule.kind} schedule`,
      event_type: "schedule_created",
      content: `${schedule.frequency} · next ${schedule.next_run_at}`,
      metadata: { schedule_id: schedule.id, flow_id: schedule.rule_id, schedule },
    });
    emitBackground({ type: "cache.refresh", resource: "schedules" });
    return Response.json({ schedule }, { status: 201 });
  }
  if (path[0] !== "schedules" || !path[1]) return null;

  const id = Number(path[1]);
  if (!Number.isSafeInteger(id) || id < 1) throw new RouteError("Invalid schedule ID", 400);
  if (method === "GET") return Response.json({ schedule: getSchedule(id) });
  if (method === "PUT") {
    const value = await confirmedBody(request, "Explicit confirmation is required to change a schedule");
    const schedule = saveSchedule(value, id);
    startHistory({
      kind: "schedule",
      title: `${schedule.enabled ? "Updated" : "Paused"} ${schedule.kind} schedule`,
      event_type: schedule.enabled ? "schedule_updated" : "schedule_paused",
      content: `${schedule.frequency} · next ${schedule.next_run_at}`,
      metadata: { schedule_id: schedule.id, flow_id: schedule.rule_id, schedule },
    });
    emitBackground({ type: "cache.refresh", resource: "schedules" });
    return Response.json({ schedule });
  }
  if (method === "DELETE") {
    await confirmedBody(request, "Explicit confirmation is required to delete a schedule");
    const schedule = deleteSchedule(id);
    startHistory({
      kind: "schedule",
      title: `Deleted ${schedule.kind} schedule`,
      event_type: "schedule_deleted",
      content: `Removed ${schedule.frequency} schedule`,
      metadata: { schedule_id: schedule.id, flow_id: schedule.rule_id },
    });
    emitBackground({ type: "cache.refresh", resource: "schedules" });
    return Response.json({ deleted: id });
  }
  return null;
};
