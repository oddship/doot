import type { ApiRouteHandler } from "@/lib/api/context";
import { RouteError } from "@/lib/api/context";
import { store } from "@/lib/store";
import { generatedWorkspaceSchema } from "@/lib/workspace";

export const handleWorkspaceRoutes: ApiRouteHandler = async ({ path, key, method }) => {
  if (key === "dashboard" && method === "GET") return Response.json(await store(["dashboard"]));
  if (key === "artifacts" && method === "GET") return Response.json(await store(["artifact-list"]));
  if (path[0] !== "workspaces" || method !== "GET") return null;

  const id = path[1] || "latest";
  let result: any;
  try {
    result = await store<any>(["workspace-get", id]);
  } catch (error) {
    if (id === "latest" && String((error as Error)?.message || error) === "workspace not found")
      return Response.json({ workspace: null });
    throw error;
  }
  if (result.workspace.schema_version === 1) {
    const parsed = generatedWorkspaceSchema.safeParse(result.workspace.spec);
    if (!parsed.success) throw new RouteError("Saved workspace is not compatible with this application version", 422);
    result.workspace.spec = parsed.data;
    result.workspace.compatible = true;
  } else result.workspace.compatible = false;
  return Response.json(result);
};
