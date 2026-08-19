// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compactCss, compactSource } from "./source-contract";

describe("Inbox deep links", () => {
  it("uses dashboard URL filters for the initial server-side message query", async () => {
    const source = compactSource(await readFile("app/inbox/page.tsx", "utf8"));
    expect(source).toContain('store<any>([ "list", "--account", account, "--query", query');
    expect(source).toContain("initialAccount={account}");
    expect(source).toContain("initialQuery={query}");
  });

  it("keeps interactive searches and account changes reflected in the URL", async () => {
    const source = await readFile("components/inbox-client.tsx", "utf8");
    expect(source).toContain("history.replaceState");
    expect(source).toContain("load(0, value, query)");
  });

  it("requires the Agent to validate generated Inbox queries", async () => {
    const source = await readFile("lib/agent-runtime.ts", "utf8");
    expect(source).toContain("Dashboard Inbox-query contract");
    expect(source).toContain("Validate every Inbox link with email_search before rendering");
    expect(source).toContain("state.validatedSearches.add");
  });

  it("can select or clear every message on the visible page", async () => {
    const source = await readFile("components/inbox-client.tsx", "utf8");
    expect(source).toContain("Select page");
    expect(source).toContain("Clear page");
    expect(source).toContain("pageIds.every");
  });

  it("can clear the persistent selection across all pages", async () => {
    const client = compactSource(await readFile("components/inbox-client.tsx", "utf8"));
    expect(client).toContain("Unselect all");
    expect(client).toContain("saveSelectedIds([])");
    expect(client).toContain("setSelected([])");
  });

  it("moves a single-account selection to a discovered safe destination", async () => {
    const client = compactSource(await readFile("components/inbox-client.tsx", "utf8"));
    expect(client).toContain('propose("move", moveChoice?.target)');
    expect(client).toContain("rule_target_allowed !== false");
    expect(client).toContain("Select messages from one account at a time");
    expect(client).toContain("Destination:");
  });

  it("offers deletion directly from an opened message behind a proposal", async () => {
    const client = compactSource(await readFile("components/inbox-client.tsx", "utf8"));
    expect(client).toContain("Delete message");
    expect(client).toContain('createManualProposal( "delete"');
    expect(client).toContain('title="Confirm mailbox change"');
    expect(client).toContain("Confirm and apply");
  });

  it("offers numbered pages, maximum result options, and a viewport-bounded shell", async () => {
    const source = compactSource(await readFile("components/inbox-client.tsx", "utf8"));
    const css = compactCss(await readFile("app/globals.css", "utf8"));
    expect(source).toContain('aria-label="Inbox pages"');
    expect(source).toContain("Maximum results per page");
    expect(source).toContain("[25, 50, 100]");
    expect(css).toContain(".inbox-page{height:calc(100vh - 64px);overflow:hidden");
    expect(css).toContain(".inbox-page .inbox-layout{height:auto;min-height:0;flex:1;");
  });

  it("shows both localized date and time in the Inbox list", async () => {
    const source = await readFile("components/inbox-client.tsx", "utf8");
    expect(source).toContain("<LocalTime value={mail.date} />");
    expect(source).not.toContain("toLocaleDateString");
  });
});
