import type { ApiRouteHandler } from "@/lib/api/context";
import { RouteError, requestBody } from "@/lib/api/context";
import { runDueSchedules } from "@/lib/schedules";
import { store } from "@/lib/store";

export const handleSystemRoutes: ApiRouteHandler = async ({ request, key, method }) => {
  if (key === "health" && method === "GET")
    return Response.json({ ok: true, runtime: "next+pi+imapflow", sqlite: true, read_preserving: true });
  if (key === "scheduler/tick" && method === "POST") {
    if (request.headers.get("x-doot-scheduler-token") !== (globalThis as any).__dootSchedulerToken)
      throw new RouteError("Not found", 404);
    return Response.json(await runDueSchedules());
  }
  if (key === "settings" && method === "GET") return Response.json(await store(["settings-get"]));
  if (key === "settings" && method === "PUT")
    return Response.json(await store(["settings-set", JSON.stringify(await requestBody(request))]));
  return null;
};
