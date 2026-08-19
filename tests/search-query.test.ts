import { describe, expect, it } from "vitest";
import { escapedLikeContains, parseSearchQuery } from "@/lib/search-query";

describe("Inbox search syntax", () => {
  it("separates sender operators from full-text terms", () => {
    expect(parseSearchQuery('from:notifications@github.com "Run failed"')).toEqual({
      text: '"Run failed"',
      senders: ["notifications@github.com"],
      subjects: [],
      domains: [],
    });
  });

  it("supports quoted subject and domain filters", () => {
    expect(parseSearchQuery('subject:"Payment received" domain:@example.com')).toEqual({
      text: "",
      senders: [],
      subjects: ["Payment received"],
      domains: ["example.com"],
    });
  });

  it("escapes SQL LIKE wildcards", () => {
    expect(escapedLikeContains("billing_100%")).toBe("%billing\\_100\\%%");
  });
});
