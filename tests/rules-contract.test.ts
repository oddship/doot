// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compactSource, readApiRoutes } from "./source-contract";

describe("first-class email flows", () => {
  it("persists filter/action rules and exposes CRUD, preview, and proposal APIs", async () => {
    const database = await readFile("lib/database.ts", "utf8");
    const route = await readApiRoutes();
    expect(database).toContain("CREATE TABLE IF NOT EXISTS email_rules");
    expect(route).toContain('key === "rules" && method === "GET"');
    expect(route).toContain('path[2] === "preview"');
    expect(route).toContain('path[2] === "propose"');
  });

  it("gives Agent a disabled suggestion tool with exact-query validation", async () => {
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    expect(runtime).toContain('name: "email_suggest_flow"');
    expect(runtime).toContain('status: "suggested", enabled: false');
    expect(runtime).toContain("Validate the exact flow account/query");
    expect(runtime).toContain('enum: ["archive", "move", "delete"]');
  });

  it("lets a selected flow return to Agent for safe conversational edits", async () => {
    const client = await readFile("components/rules-client.tsx", "utf8");
    const workspace = await readFile("components/workspace-client.tsx", "utf8");
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    expect(client).toContain("Ask Doot to modify");
    expect(client).toContain("saveSelectedRule");
    expect(workspace).toContain("selectedRule: loadSelectedRule()");
    expect(runtime).toContain('name: "email_update_selected_flow"');
    expect(runtime).toContain('status: "suggested", enabled: false');
    expect(runtime).toContain("user selected this persisted flow");
  });

  it("keeps Agent-offered deletion behind flow review and explicit approval", async () => {
    const rules = await readFile("lib/rules.ts", "utf8");
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    const client = await readFile("components/rules-client.tsx", "utf8");
    expect(rules).toContain('["archive", "move", "delete"]');
    expect(runtime).toContain("Deletion may be recommended");
    expect(client).toContain("Delete flows remain manual");
    expect(client).toContain("Approve and run flow");
    expect(client).toContain("confirm: true");
  });

  it("previews first and keeps execution proposal-only behind final browser approval", async () => {
    const client = compactSource(await readFile("components/rules-client.tsx", "utf8"));
    const route = compactSource(await readApiRoutes());
    expect(client).toContain("Review &amp; run");
    expect(client).toContain("Approve and run flow");
    expect(client).toContain("The saved flow itself never runs automatically");
    expect(route).toContain('path[2] === "run"');
    expect(route).toContain('["rule-propose", id]');
    expect(route).toContain('["apply", String(prepared.proposal.id)]');
    expect(client).toContain("confirm: true");
    expect(client).toContain("closeDisabled={applying}");
    expect(client).toContain("Updating the mailbox. Keep this dialog open");
  });

  it("keeps exact approval targets readable instead of truncating them", async () => {
    const [client, css] = await Promise.all([
      readFile("components/rules-client.tsx", "utf8"),
      readFile("app/styles/flows.css", "utf8"),
    ]);
    expect(client).toContain("rule-approval-filter");
    expect(client).toContain("rule-approval-account");
    expect(css).toContain(".rule-definition.rule-approval-definition");
    expect(css).toContain("overflow-wrap: anywhere");
  });

  it("defines activation as readiness rather than automatic execution", async () => {
    const [client, guide, rules] = await Promise.all([
      readFile("components/rules-client.tsx", "utf8"),
      readFile("docs/01-guide/04-flows.md", "utf8"),
      readFile("lib/rules.ts", "utf8"),
    ]);
    expect(client).toContain("Reviewed; schedules may evaluate it");
    expect(client).toContain("Mark reviewed and schedulable");
    expect(client).not.toContain("flow-activation-note");
    expect(client).toContain("Mark active");
    expect(guide).toContain("Active means reviewed and eligible for attached schedules");
    expect(guide).toContain("Scheduled evaluations prepare proposals for review");
    expect(guide).toContain("Review & run");
    expect(rules).toContain('enabled ? "active"');
  });

  it("directs Agent suggestions into the persisted flow review experience", async () => {
    const [runtime, workspace] = await Promise.all([
      readFile("lib/agent-runtime.ts", "utf8"),
      readFile("components/workspace-client.tsx", "utf8"),
    ]);
    expect(runtime).toContain("flow_suggestion card whose action is open_flow");
    expect(runtime).toContain("Flows review, preview, and approve/run experience");
    expect(workspace).toContain('label="Review flow"');
    expect(workspace).toContain("artifact-review-link");
    expect(workspace).toContain("Open this flow for review");
  });

  it("gives every persisted flow a canonical addressable page and redirects legacy rule URLs", async () => {
    const page = await readFile("app/flows/[id]/page.tsx", "utf8");
    const legacy = await readFile("app/rules/[id]/page.tsx", "utf8");
    const client = await readFile("components/rules-client.tsx", "utf8");
    const workspace = await readFile("components/generated-workspace.tsx", "utf8");
    expect(page).toContain("initialFocus={id}");
    expect(page).toContain("notFound()");
    expect(client).toContain("href={`/flows/${rule.id}`}");
    expect(workspace).toContain("`/flows/${intent.flowId}`");
    expect(legacy).toContain("redirect(`/flows/");
  });

  it("does not let focus and recommendation requests substitute search links for flows", async () => {
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    expect(runtime).toContain("requiresReviewFlow: boolean");
    expect(runtime).toContain("function hasReviewFlow");
    expect(runtime).toContain("Search links are navigation, not a recommendation flow");
    expect(runtime).toContain("a reason to keep the flow disabled for review, not a reason to omit the suggestion");
  });
});
