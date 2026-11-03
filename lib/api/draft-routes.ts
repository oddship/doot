import type { ApiRouteHandler } from "@/lib/api/context";
import { confirmedBody, RouteError, requestBody } from "@/lib/api/context";
import { approveDraftUpload } from "@/lib/background-jobs";
import { deleteLocalDraft, getDraft, listDrafts, saveLocalDraft } from "@/lib/drafts";
import { emitBackground } from "@/lib/store";

export const handleDraftRoutes: ApiRouteHandler = async ({ request, path, key, method }) => {
  if (key === "drafts" && method === "GET") return Response.json(listDrafts());
  if (key === "drafts" && method === "POST")
    return Response.json({ draft: saveLocalDraft(await requestBody(request)) }, { status: 201 });
  if (path[0] !== "drafts" || !path[1]) return null;

  const id = Number(path[1]);
  if (!Number.isSafeInteger(id) || id < 1) throw new RouteError("Invalid draft ID", 400);
  if (path[2] === "save" && method === "POST") {
    await confirmedBody(request, "Explicit confirmation is required to save a draft to IMAP");
    const job = approveDraftUpload(getDraft(id).draft);
    return Response.json({ job }, { status: 202 });
  }
  if (method === "GET") return Response.json(getDraft(id));
  if (method === "PUT") {
    const draft = saveLocalDraft(await requestBody(request), id);
    emitBackground({ type: "cache.refresh", resource: "drafts" });
    return Response.json({ draft });
  }
  if (method === "DELETE") {
    await confirmedBody(request, "Explicit confirmation is required to remove a local draft");
    const result = deleteLocalDraft(id);
    emitBackground({ type: "cache.refresh", resource: "drafts" });
    return Response.json(result);
  }
  return null;
};
