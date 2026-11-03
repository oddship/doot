import type { ApiRouteHandler } from "@/lib/api/context";
import { RouteError, requestBody } from "@/lib/api/context";
import { getAppState, setAppState } from "@/lib/app-state";
import { runDueSchedules } from "@/lib/schedules";
import { store } from "@/lib/store";

export const handleSystemRoutes: ApiRouteHandler = async ({ request, key, method }) => {
  if (key === "app-state" && method === "GET") return Response.json({ state: getAppState() });
  if (key === "app-state" && method === "PUT") {
    const value = await requestBody(request);
    return Response.json({ value: setAppState(value.key, value.value) });
  }
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
