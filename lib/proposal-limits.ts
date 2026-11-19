export const DEFAULT_PROPOSAL_ITEM_LIMIT = 100;
export const MAX_PROPOSAL_ITEMS = 10_000;

export function proposalItemLimit(value: unknown = DEFAULT_PROPOSAL_ITEM_LIMIT) {
  const limit = Number(value);
  if (
    !["number", "string"].includes(typeof value) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_PROPOSAL_ITEMS
  )
    throw new Error(`Maximum emails per proposal must be a whole number from 1 to ${MAX_PROPOSAL_ITEMS}`);
  return limit;
}
