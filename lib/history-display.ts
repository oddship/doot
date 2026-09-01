const LEGACY_CONTEXT_MARKERS = [
  "\n\nThis request requires a proactive, reviewable workflow",
  "\n\nDurable memory catalog",
  "\n\nDurable memory is currently empty",
  "\n\nThe user explicitly selected",
  "\n\nThe user selected",
];

const ORGANIZE_PROMPT_PREFIX = "Analyze the complete cache with email_facets";

export function visibleUserPrompt(content: unknown) {
  const value = String(content || "").trim();
  if (!value) return "";
  if (value.startsWith(ORGANIZE_PROMPT_PREFIX)) return "Organize inboxes";
  const boundary = LEGACY_CONTEXT_MARKERS.reduce((earliest, marker) => {
    const index = value.indexOf(marker);
    return index >= 0 && index < earliest ? index : earliest;
  }, value.length);
  return value.slice(0, boundary).trim();
}

export function historyEventLabel(eventType: string) {
  if (eventType === "user_prompt") return "User message";
  return eventType.replaceAll("_", " ");
}
