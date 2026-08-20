// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("frozen demo architecture", () => {
  it("renders production screens instead of recreating them", async () => {
    const source = await readFile("demo-site/app/demo-client.tsx", "utf8");
    for (const component of [
      "AppHeader",
      "DraftsClient",
      "WorkspaceClient",
      "InboxClient",
      "RulesClient",
      "HistoryScreen",
      "SettingsClient",
    ]) {
      expect(source).toContain(`import { ${component}`);
      expect(source).toContain(`<${component}`);
    }
    for (const duplicatedScreenClass of ["mail-item", "rule-hero", "settings-section", "generated-header"]) {
      expect(source).not.toContain(duplicatedScreenClass);
    }
  });

  it("keeps every fixture fictional", async () => {
    const names = ["conversation", "drafts", "flows", "history", "message", "messages", "settings", "workspace"];
    const fixtures = await Promise.all(names.map((name) => readFile(`demo-site/fixtures/${name}.json`, "utf8")));
    for (const fixture of fixtures) {
      expect(fixture).not.toMatch(/gmail\.com|fastmail\.com|yahoo\.com|outlook\.com/i);
    }
    expect(fixtures.join("\n")).toMatch(/example/i);
  });

  it("serves schedules and unified history from frozen fixtures", async () => {
    const source = await readFile("demo-site/app/demo-client.tsx", "utf8");
    const flows = await readFile("demo-site/fixtures/flows.json", "utf8");
    const history = await readFile("demo-site/fixtures/history.json", "utf8");
    expect(source).toContain('path === "/api/schedules"');
    expect(flows).toContain('"schedules"');
    expect(history).toContain('"history_kind": "flow"');
    expect(history).toContain('"history_kind": "action"');
    expect(history).toContain('"history_kind": "schedule"');
  });
});
