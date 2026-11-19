const number = { type: "integer", minimum: 0 };
const ref = { account: { type: "string" }, folder: { type: "string" }, uid: { type: "string" } };
export const reviewProgressOutputSchema = {
  type: "object",
  properties: {
    review_id: { type: "string" },
    total: number,
    bodies_read: number,
    fully_read: number,
    unread: number,
    decided: number,
    pending_decisions: number,
    in_flight: number,
    dispositions: { type: "object", properties: { delete: number, retain: number, uncertain: number } },
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ...ref,
          initial_read: { type: "boolean" },
          fully_read: { type: "boolean" },
          body_chars_total: { type: ["integer", "null"] },
          covered_ranges: { type: "array", items: { type: "array", items: number } },
          next_body_offset: { type: ["integer", "null"] },
          verdict: {
            type: ["object", "null"],
            properties: {
              disposition: { type: "string", enum: ["delete", "retain", "uncertain"] },
              reason: { type: "string" },
            },
          },
        },
      },
    },
    next_offset: { type: ["integer", "null"] },
  },
};
export const reviewReadOutputSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["read", "busy", "complete_for_depth"] },
    progress: reviewProgressOutputSchema,
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ...ref,
          sender: { type: "string" },
          subject: { type: "string" },
          body_text: { type: "string" },
          body_offset: number,
          body_range_end: number,
          body_chars_total: number,
          body_next_offset: { type: ["integer", "null"] },
          body_has_more: { type: "boolean" },
          body_is_partial: { type: "boolean" },
          attachments: { type: "array", items: { type: "object" } },
        },
      },
    },
    metrics: { type: "object" },
  },
};
