import { listModels, updateRuntimeKey } from "@/lib/agent-runtime";
import type { ApiRouteHandler } from "@/lib/api/context";
import { confirmedBody, requestBody } from "@/lib/api/context";
import {
  cancelProviderLogin,
  getProviderLogin,
  listProviderAuth,
  logoutProvider,
  respondToProviderLogin,
  startProviderLogin,
} from "@/lib/provider-auth";
import { store } from "@/lib/store";

export const handleAgentRoutes: ApiRouteHandler = async ({ request, path, key, method, url }) => {
  if (key === "agent/sessions" && method === "GET") return Response.json(await store(["session-list"]));
  if (path[0] === "agent" && path[1] === "sessions" && path[2] && method === "GET")
    return Response.json(await store(["session-get", path[2]]));
  if (key === "agent/models" && method === "GET") return Response.json({ models: await listModels() });
  if (key === "agent/auth/providers" && method === "GET") return Response.json(await listProviderAuth());
  if (key === "agent/auth/login" && method === "POST") {
    const value = await requestBody(request);
    return Response.json(
      await startProviderLogin(String(value.provider || ""), value.auth_type === "oauth" ? "oauth" : "api_key"),
      { status: 202 },
    );
  }
  if (path[0] === "agent" && path[1] === "auth" && path[2] === "login" && path[3]) {
    const id = path[3];
    if (method === "GET") return Response.json(getProviderLogin(id));
    if (method === "POST") {
      const value = await requestBody(request);
      return Response.json(respondToProviderLogin(id, String(value.prompt_id || ""), String(value.value || "")));
    }
    if (method === "DELETE") return Response.json(cancelProviderLogin(id));
  }
  if (path[0] === "agent" && path[1] === "auth" && path[2] === "providers" && path[3] && method === "DELETE") {
    await confirmedBody(request, "Explicit confirmation is required to remove provider credentials");
    return Response.json(await logoutProvider(path[3]));
  }
  if (key === "agent/credentials" && method === "GET") return Response.json(await store(["agent-keys"]));
  if (key === "agent/credentials" && method === "PUT") {
    const value = await requestBody(request);
    const provider = String(value.provider || "");
    const apiKey = String(value.api_key || "");
    await updateRuntimeKey(provider, apiKey);
    return Response.json({ provider, configured: Boolean(apiKey) });
  }
  if (key === "agent/memory" && method === "GET") {
    const namespace = url.searchParams.get("namespace");
    return Response.json(
      namespace
        ? await store(["memory-list", namespace, "--prefix", url.searchParams.get("prefix") || "", "--limit", "100"])
        : await store(["memory-namespaces"]),
    );
  }
  if (key === "agent/memory" && method === "PUT") {
    const value = await requestBody(request);
    return Response.json(
      await store(["memory-set", String(value.namespace || ""), String(value.key || ""), JSON.stringify(value.value)]),
    );
  }
  if (key === "agent/memory" && method === "DELETE") {
    const value = await confirmedBody(request);
    return Response.json(await store(["memory-delete", String(value.namespace || ""), String(value.key || "")]));
  }
  return null;
};
