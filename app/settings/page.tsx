import { SettingsClient } from "@/components/settings-client";
import { listModels } from "@/lib/agent-runtime";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const [{ accounts }, { settings }, credentials, artifacts, memory, folderCache, models] = await Promise.all([
    store<any>(["accounts"]),
    store<any>(["settings-get"]),
    store<any>(["agent-keys"]),
    store<any>(["artifact-list"]),
    store<any>(["memory-namespaces"]),
    store<any>(["folder-cache"]),
    listModels().catch(() => []),
  ]);
  return (
    <SettingsClient
      initial={{
        accounts,
        settings,
        credentials: credentials.credentials,
        artifacts: artifacts.artifacts,
        memoryNamespaces: memory.namespaces,
        folders: folderCache.folders,
        models,
      }}
    />
  );
}
