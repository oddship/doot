import { describe, expect, it } from "vitest";
import { paginationItems } from "@/lib/pagination";

describe("Inbox pagination", () => {
  it("shows every page for small result sets", () => {
    expect(paginationItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps large page lists compact around the current page", () => {
    expect(paginationItems(8, 20)).toEqual([1, "ellipsis", 7, 8, 9, "ellipsis", 20]);
  });
});
