import { SettingsClient } from "@/components/settings-client";
import { listModels } from "@/lib/agent-runtime";
import { listProviderAuth } from "@/lib/provider-auth";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const [{ accounts }, { settings }, providers, artifacts, memory, folderCache, models] = await Promise.all([
    store<any>(["accounts"]),
    store<any>(["settings-get"]),
    listProviderAuth(),
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
        providers: providers.providers,
        artifacts: artifacts.artifacts,
        memoryNamespaces: memory.namespaces,
        folders: folderCache.folders,
        models,
      }}
    />
  );
}
