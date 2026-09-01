function detailsOf(result: any) {
  return result?.details && typeof result.details === "object" ? result.details : result;
}

export function compactEmailSearchResult(result: any) {
  return {
    messages: (result.messages || []).map((message: any) => ({
      account: message.account,
      uid: String(message.uid),
      folder: message.folder,
      sender: message.sender,
      subject: message.subject,
      date: message.date,
      unread: Boolean(message.unread),
    })),
    total: result.total,
    offset: result.offset,
    limit: result.limit,
    next_offset: result.next_offset,
    filters: result.filters,
  };
}

export function toolInputSummary(name: string, args: any = {}) {
  if (name === "email_search")
    return [
      args.account && args.account !== "all" ? args.account : "all accounts",
      args.query || args.sender || args.domain || "all cached mail",
    ].join(" · ");
  if (name === "email_facets")
    return `Analyze ${args.query || "the complete cache"}${args.account && args.account !== "all" ? ` · ${args.account}` : ""}`;
  if (name === "email_suggest_flow") return `${args.action || "review"} · ${args.query || "flow pattern"}`;
  if (name === "email_list_folders") return args.account || "Connected account";
  if (name === "email_request_body_access")
    return `${Array.isArray(args.messages) ? args.messages.length : 0} message(s) · ${args.reason || "approval needed"}`;
  if (name === "email_read_selected")
    return `${Array.isArray(args.messages) && args.messages.length ? args.messages.length : "Selected"} message body access`;
  if (name.startsWith("memory_")) return [args.namespace, args.key].filter(Boolean).join(" / ") || "Durable memory";
  return "Working with local data…";
}

export function toolResultSummary(name: string, result: any, isError = false) {
  if (isError) return "Failed — open History for details";
  const value = detailsOf(result) || {};
  if (name === "email_search")
    return `${Number(value.total || 0).toLocaleString()} matches · ${(value.messages || []).length} returned${value.next_offset != null ? " · more available" : ""}`;
  if (name === "email_facets")
    return `${Number(value.total || 0).toLocaleString()} analyzed · ${(value.top_senders || []).length} sender groups · ${(value.accounts || []).length} accounts`;
  if (name === "email_list_folders")
    return `${(value.folders || []).length} ${value.provider === "gmail" ? "labels" : "folders"} discovered`;
  if (name === "email_suggest_flow") return `Disabled flow saved · ${value.name || "ready for review"}`;
  if (name === "email_propose_organization")
    return `Proposal ${value.id || ""} created · ${(value.items || []).length} messages`;
  if (name === "render_workspace") return `Workspace ${value.workspace_id || ""} rendered`;
  if (name === "update_workspace") return `Dashboard updated · ${value.operations_applied || 0} changes`;
  if (name === "get_current_workspace") return `Loaded dashboard ${value.id || ""}`;
  if (name === "email_read_selected") return `${(value.messages || []).length} selected messages read safely`;
  if (name === "email_request_body_access")
    return `${(value.messages || []).length} message body request awaiting approval`;
  if (name === "memory_namespaces") return `${(value.namespaces || []).length} memory namespaces`;
  if (name === "memory_list") return `${(value.items || []).length} memory entries`;
  if (name === "memory_get") return value.found ? "Memory retrieved" : "No matching memory";
  if (name === "memory_set") return value.created ? "Memory saved" : "Memory updated";
  if (name === "memory_delete") return value.deleted ? "Memory removed" : "Memory was already absent";
  return "Completed";
}
