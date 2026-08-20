import { WorkspaceClient } from "@/components/workspace-client";
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
  const initialModel =
    settings.agent_provider && settings.agent_model
      ? { provider: settings.agent_provider, id: settings.agent_model }
      : { name: "Automatic" };
  return <WorkspaceClient initialWorkspace={initial} initialModel={initialModel} />;
}
