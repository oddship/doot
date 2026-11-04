import type { ApiRouteHandler } from "@/lib/api/context";
import { confirmedBody, RouteError, requestBody } from "@/lib/api/context";
import { approveFolderMutation } from "@/lib/background-jobs";
import { startHistory } from "@/lib/history";
import { store } from "@/lib/store";

export const handleAccountRoutes: ApiRouteHandler = async ({ request, path, key, method }) => {
  if (key === "folders" && method === "GET") return Response.json(await store(["folder-cache"]));
  if (key === "accounts" && method === "GET") return Response.json(await store(["accounts"]));
  if (key === "accounts" && method === "POST") {
    const result = await store<any>(["account-upsert", JSON.stringify(await requestBody(request))]);
    startHistory({
      kind: "action",
      title: `Connected account · ${result.account?.email || result.account?.name || "IMAP"}`,
      event_type: "account_connected",
      content: "Added an IMAP account. Credentials are not included in History.",
      metadata: { account: result.account?.name, provider: result.account?.provider },
    });
    if (result.account?.name) void store(["account-warm", result.account.name]).catch(() => undefined);
    return Response.json(result, { status: 201 });
  }
  if (path[0] !== "accounts" || path.length < 2) return null;

  const name = decodeURIComponent(path[1]);
  if (path[2] === "test" && method === "POST") return Response.json(await store(["account-test", name]));
  if (path[2] === "warm" && method === "POST") {
    const empty =
      !request.headers.get("content-type") &&
      !request.headers.get("transfer-encoding") &&
      [null, "0"].includes(request.headers.get("content-length"));
    const value = empty ? {} : await requestBody(request);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new RouteError("Invalid reader options", 400);
    if (value.folder !== undefined && (typeof value.folder !== "string" || !value.folder || value.folder.length > 500))
      throw new RouteError("Invalid folder", 400);
    return Response.json(await store(["account-warm", name, value.folder || "INBOX"]));
  }
  if (path[2] === "folders" && method === "GET") return Response.json(await store(["account-folders", name]));
  if (path[2] === "folders" && ["POST", "PUT", "DELETE"].includes(method)) {
    const value = await confirmedBody(request, "Explicit confirmation is required for every IMAP folder write");
    const action = method === "POST" ? "create" : method === "PUT" ? "rename" : "delete";
    if (typeof value.command_id !== "string" || !value.command_id)
      throw new RouteError("A stable command ID is required", 400);
    const operation = { action, path: value.path, ...(action === "rename" ? { new_path: value.new_path } : {}) };
    const job = approveFolderMutation(name, operation, value.command_id);
    return Response.json({ job }, { status: 202 });
  }
  if (method === "PUT") {
    const result = await store<any>(["account-upsert", JSON.stringify({ ...(await requestBody(request)), name })]);
    startHistory({
      kind: "action",
      title: `Updated account · ${result.account?.email || name}`,
      event_type: "account_updated",
      content: "Updated IMAP account configuration. Credentials are not included in History.",
      metadata: { account: name, provider: result.account?.provider },
    });
    void store(["account-warm", name]).catch(() => undefined);
    return Response.json(result);
  }
  if (method === "DELETE") {
    await confirmedBody(request);
    const result = await store(["account-delete", name]);
    startHistory({
      kind: "action",
      title: `Disconnected account · ${name}`,
      event_type: "account_disconnected",
      content: "Removed the account configuration. Cached mail remains local.",
      metadata: { account: name },
    });
    return Response.json(result);
  }
  return null;
};
