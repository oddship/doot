export type ParsedSearchQuery = {
  text: string;
  senders: string[];
  subjects: string[];
  domains: string[];
};

/** Parse the small, documented Gmail-like subset supported by Inbox links. */
export function parseSearchQuery(input: unknown): ParsedSearchQuery {
  const senders: string[] = [],
    subjects: string[] = [],
    domains: string[] = [];
  const source = String(input || "").slice(0, 500);
  const text = source
    .replace(
      /\b(from|sender|subject|domain):(?:"([^"]{1,200})"|([^\s"]{1,200}))/gi,
      (_match, rawOperator, quoted, bare) => {
        const operator = String(rawOperator).toLowerCase();
        const value = String(quoted || bare || "").trim();
        if (!value) return "";
        if (operator === "from" || operator === "sender") senders.push(value);
        else if (operator === "subject") subjects.push(value);
        else domains.push(value.replace(/^@/, ""));
        return " ";
      },
    )
    .replace(/\s+/g, " ")
    .trim();
  return { text, senders, subjects, domains };
}

export function escapedLikeContains(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}
