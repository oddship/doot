export type PaginationItem = number | "ellipsis";

export function paginationItems(current: number, total: number): PaginationItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = [
    ...new Set([1, total, current - 1, current, current + 1].filter((page) => page >= 1 && page <= total)),
  ].sort((a, b) => a - b);
  const result: PaginationItem[] = [];
  for (const page of pages) {
    const previous = result[result.length - 1];
    if (typeof previous === "number" && page - previous > 1) result.push("ellipsis");
    result.push(page);
  }
  return result;
}
