// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compactSource } from "./source-contract";

describe("Agent message body approval", () => {
  it("provides a header-only request tool before selected-body access", async () => {
    const runtime = compactSource(await readFile("lib/agent-runtime.ts", "utf8"));
    const requestStart = runtime.indexOf('name: "email_request_body_access"');
    const selectedReadStart = runtime.indexOf('name: "email_read_selected"');
    const requestTool = runtime.slice(requestStart, selectedReadStart);
    expect(requestStart).toBeGreaterThan(0);
    expect(requestTool).toContain('store<any>(["message-context"');
    expect(requestTool).toContain('type: "data-read-approval"');
    expect(requestTool).not.toContain('store(["read"');
    expect(runtime).toContain("then stop and wait for browser approval");
  });

  it("shows exact messages and continues only after browser approval", async () => {
    const workspace = compactSource(await readFile("components/workspace-client.tsx", "utf8"));
    expect(workspace).toContain('event.type === "data-read-approval"');
    expect(workspace).toContain("Approve and continue");
    expect(workspace).toContain("Not now");
    expect(workspace).toContain("saveSelectedIds");
    expect(workspace).toContain("Read the selected message");
  });
});
