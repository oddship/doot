export function requiresReviewAction(text: string, organize = false) {
  // A review can finish with findings or a body-access request. It is not a
  // request to invent an automation simply because it mentions the inbox.
  if (
    /\b(?:do not|don't|no|without)\s+(?:want\s+|(?:create|creating|apply|applying)(?:\s*(?:\/|or|and)\s*(?:create|creating|apply|applying))?\s+|new\s+|any\s+)*(?:flows?|rules?|proposals?)\b/i.test(
      text,
    )
  )
    return false;
  return (
    organize ||
    /\b(?:create|suggest|recommend|prepare|add|set up)\b[^.!?\n]*\b(?:flows?|rules?|proposals?)\b/i.test(text)
  );
}
