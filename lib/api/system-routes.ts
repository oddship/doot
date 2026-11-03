import { ZodError } from "zod";
import type { ApiRouteHandler } from "@/lib/api/context";
import { RouteError, requestBody } from "@/lib/api/context";
import { getAppState, setAppStateRequest } from "@/lib/app-state";
import { getBackgroundJob, listBackgroundJobs, recoverBackgroundJobs } from "@/lib/background-jobs";
import { runDueSchedules } from "@/lib/schedules";
import { store } from "@/lib/store";
import { startConfiguredSync } from "@/lib/sync";

export const handleSystemRoutes: ApiRouteHandler = async ({ request, key, method, path }) => {
  if (key === "app-state" && method === "GET") return Response.json({ state: getAppState() });
  if (key === "app-state" && method === "PUT") {
    const value = await requestBody(request);
    try {
      return Response.json({ value: setAppStateRequest(value) });
    } catch (error) {
      if (error instanceof ZodError) throw new RouteError("Invalid app state value", 400);
      throw error;
    }
  }
  if (key === "jobs" && method === "GET") return Response.json(listBackgroundJobs());
  if (path[0] === "jobs" && path[1] && method === "GET") return Response.json({ job: getBackgroundJob(path[1]) });
  if (key === "background/recover" && method === "POST") {
    if (
      !process.env.DOOT_INSTANCE_ID ||
      request.headers.get("x-doot-scheduler-token") !== (globalThis as any).__dootSchedulerToken
    )
      throw new RouteError("Not found", 404);
    recoverBackgroundJobs();
    await startConfiguredSync();
    return Response.json({ ok: true });
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
