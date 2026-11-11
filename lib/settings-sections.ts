export const settingsSections = [
  ["accounts", "Accounts"],
  ["provider", "AI providers"],
  ["agent", "Doot model"],
  ["classifier", "Classification"],
  ["folders", "Folders"],
  ["memory", "Memory"],
  ["sync", "Sync"],
  ["schedules", "Schedules"],
  ["privacy", "Privacy"],
  ["artifacts", "Saved items"],
] as const;
export function settingsSection(hash: string) {
  const id = hash.replace(/^#/, "");
  if (id.startsWith("artifact-")) return "artifacts";
  return settingsSections.find(([value]) => value === id)?.[0] || "accounts";
}
