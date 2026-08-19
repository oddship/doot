import { WorkspaceClient } from "@/components/workspace-client";
import { store } from "@/lib/store";
import { generatedWorkspaceSchema } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  let initial: unknown = null;
  try {
    const result = await store<any>(["workspace-get", "latest"]);
    if (result.workspace.schema_version === 1) initial = generatedWorkspaceSchema.parse(result.workspace.spec);
    else initial = { legacy: result.workspace.spec };
  } catch {}
  return <WorkspaceClient initialWorkspace={initial} />;
}
