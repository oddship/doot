// Only server-recorded creation events confer conversation ownership. Inspection
// and failed tool calls never grant permission; browser selection is separate.
export function conversationFlowIds(events: Array<{ event_type?: string; content?: string; metadata?: any }>) {
  const ids = new Set<number>();
  const add = (id: unknown) => {
    if (Number.isSafeInteger(id) && Number(id) > 0) ids.add(Number(id));
  };
  for (const event of events) {
    if (event.event_type === "flow_created") add(event.metadata?.flow_id);
    if (event.event_type === "flow_access_inherited") for (const id of event.metadata?.flow_ids || []) add(id);
    // Compatibility with conversations created before explicit ownership events.
    if (
      event.event_type === "tool_end" &&
      event.content === "email_suggest_flow" &&
      event.metadata?.is_error === false
    ) {
      try {
        add(JSON.parse(event.metadata.result_preview).details?.id);
      } catch {
        /* truncated preview grants nothing */
      }
    }
  }
  return ids;
}
