import type { ApiRouteHandler } from "@/lib/api/context";
import { confirmedBody, requestBody } from "@/lib/api/context";
import { startHistory } from "@/lib/history";
import { emitBackground, store } from "@/lib/store";

export const handleAccountRoutes: ApiRouteHandler = async ({ request, path, key, method }) => {
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
  if (path[2] === "warm" && method === "POST") return Response.json(await store(["account-warm", name]));
  if (path[2] === "folders" && method === "GET") return Response.json(await store(["account-folders", name]));
  if (path[2] === "folders" && ["POST", "PUT", "DELETE"].includes(method)) {
    const value = await confirmedBody(request, "Explicit confirmation is required for every IMAP folder write");
    const action = method === "POST" ? "create" : method === "PUT" ? "rename" : "delete";
    const result = await store<any>([
      "folder-mutate",
      name,
      JSON.stringify({ action, path: value.path, ...(action === "rename" ? { new_path: value.new_path } : {}) }),
    ]);
    startHistory({
      kind: "action",
      title: `${action === "create" ? "Created" : action === "rename" ? "Renamed" : "Removed"} IMAP ${result.provider === "gmail" ? "label" : "folder"}`,
      event_type: `folder_${action}`,
      content: `${name}: ${value.path}${value.new_path ? ` → ${value.new_path}` : ""}`,
      metadata: { account: name, operation: result.operation },
    });
    emitBackground({ type: "cache.refresh", resource: "folders", account: name });
    if (action !== "create") emitBackground({ type: "cache.refresh", resource: "rules" });
    return Response.json(result, { status: action === "create" ? 201 : 200 });
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
