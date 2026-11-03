import { WorkspaceClient } from "@/components/workspace-client";
import { getActiveConversationId } from "@/lib/app-state";
import { conversationRevision, replayConversation } from "@/lib/client-conversation";
import { store } from "@/lib/store";
import { generatedWorkspaceSchema } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  let initial: unknown = null;
  const { settings } = await store<any>(["settings-get"]);
  try {
    const result = await store<any>(["workspace-get", "latest"]);
    if (result.workspace.schema_version === 1) initial = generatedWorkspaceSchema.parse(result.workspace.spec);
    else initial = { legacy: result.workspace.spec };
  } catch {}
  const initialSessionId = getActiveConversationId();
  let initialRunRevision = "";
  let initialEntries: ReturnType<typeof replayConversation> = [];
  if (initialSessionId) {
    try {
      const detail: any = await store(["session-get", initialSessionId]);
      initialEntries = replayConversation(detail);
      if (detail.session?.status !== "running") initialRunRevision = conversationRevision(detail.session, detail);
    } catch {}
  }
  const initialModel =
    settings.agent_provider && settings.agent_model
      ? { provider: settings.agent_provider, id: settings.agent_model }
      : { name: "Automatic" };
  return (
    <WorkspaceClient
      initialWorkspace={initial}
      initialModel={initialModel}
      initialSessionId={initialSessionId}
      initialEntries={initialEntries}
      initialRunRevision={initialRunRevision}
    />
  );
}
