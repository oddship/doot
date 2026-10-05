// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionAPI,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  boundedCodemodeSource,
  CODEMODE_LIMITS,
  CODEMODE_READ_TOOLS,
  readOnlyCodemodeExtension,
  withCodemodePolicy,
} from "@/lib/agent-codemode";

async function runScript(
  code: string,
  execute = vi.fn(async () => ({
    toolCall: { id: "script-1/1" },
    isError: false,
    result: { content: [], details: {}, structuredContent: { total: 7 } },
  })),
) {
  let tool!: ToolDefinition;
  await readOnlyCodemodeExtension({
    registerTool: (value: ToolDefinition) => {
      tool = value;
    },
    getAllTools: () => [],
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI);
  const result = await tool.execute("script-1", { code }, new AbortController().signal, undefined, {
    tools: [
      {
        name: "email_search",
        description: "Search headers",
        parameters: { type: "object", properties: {} },
        outputSchema: {},
      },
      { name: "email_prepare_draft", description: "Write a draft", parameters: { type: "object", properties: {} } },
    ],
    sessionManager: { getBranch: () => [] },
    executeTool: execute,
  } as any);
  return {
    result,
    execute,
    text: result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  };
}

describe("read-only codemode", () => {
  it("activates codemode in an isolated real SDK session without built-ins or write access", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "doot-codemode-test-"));
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    try {
      const runtime = await ModelRuntime.create({
        credentials: {
          read: async () => undefined,
          list: async () => [],
          modify: async () => undefined,
          delete: async () => {},
        },
        modelsPath: join(cwd, "models.json"),
      });
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: cwd,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        extensionFactories: [readOnlyCodemodeExtension],
      });
      await resourceLoader.reload();
      const result = await createAgentSession({
        cwd,
        modelRuntime: runtime,
        settingsManager: SettingsManager.inMemory(),
        sessionManager: SessionManager.inMemory(),
        resourceLoader,
        noTools: "builtin",
        customTools: ["email_search", "email_prepare_draft"].map((name) =>
          withCodemodePolicy({
            name,
            label: name,
            description: name,
            parameters: { type: "object", properties: {} } as any,
            execute: async () => ({ content: [], details: {}, structuredContent: { total: 7 } }),
          }),
        ),
      });
      session = result.session;
      await session.bindExtensions({});
      session.setActiveToolsByName([...session.getActiveToolNames(), "codemode"]);
      expect(session.getActiveToolNames()).toEqual(
        expect.arrayContaining(["codemode", "email_prepare_draft", "email_search"]),
      );
      expect(session.getCallableToolNames()).toEqual(["email_search"]);
      expect(session.getActiveToolNames()).not.toEqual(expect.arrayContaining(["bash", "write", "read"]));
    } finally {
      session?.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  });
  it("defaults every unreviewed tool to model-only", () => {
    for (const name of [
      "email_prepare_draft",
      "email_propose_organization",
      "email_suggest_flow",
      "email_update_selected_flow",
      "render_workspace",
      "update_workspace",
      "email_write_artifact",
      "memory_set",
      "memory_delete",
      "email_request_body_access",
      "bash",
      "future_tool",
    ])
      expect(withCodemodePolicy({ name }).exposure).toBe("model-only");
    for (const name of CODEMODE_READ_TOOLS) {
      expect(withCodemodePolicy({ name })).toMatchObject({
        exposure: "direct",
        outputSchema: {},
        annotations: { readOnlyHint: true },
      });
    }
  });

  it("overrides script options with host limits", () => {
    const source = boundedCodemodeSource('// @options: {"timeout_ms":999999,"max_output_tokens":999999}\nreturn 1;');
    expect(source).not.toContain("999999");
    expect(source).toContain(`"timeout_ms":${CODEMODE_LIMITS.timeoutMs}`);
    expect(source).toContain(`"max_output_tokens":${CODEMODE_LIMITS.outputTokens}`);
  });

  it("executes the real Pi sandbox with structured header results", async () => {
    const { text, execute } = await runScript(
      "const result = await tools.email_search({}); return { count: result.total };",
    );
    expect(text).toContain("Script completed");
    expect(text).toContain('"count":7');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not expose writes, unapproved tools, models, Node, or network to scripts", async () => {
    const { text, execute } = await runScript(
      "return { tools: ALL_TOOLS.map(t => t.name), models: typeof models, process: typeof process, fetch: typeof fetch };",
    );
    expect(text).toContain("email_search");
    expect(text).not.toContain("email_prepare_draft");
    expect(text).toContain('"models":"undefined"');
    expect(text).toContain('"process":"undefined"');
    expect(text).toContain('"fetch":"undefined"');
    expect(execute).not.toHaveBeenCalled();
    const blocked = await runScript("await tools.email_prepare_draft({});");
    expect(blocked.text).toContain("Script failed");
    expect(blocked.execute).not.toHaveBeenCalled();
  });

  it("caps tool calls even when the script catches errors", async () => {
    const { text, execute } = await runScript(
      "for (let i=0;i<45;i++) { try { await tools.email_search({}); } catch (e) { text(e.message); } }",
    );
    expect(text).toContain("budget exceeded");
    expect(execute).toHaveBeenCalledTimes(CODEMODE_LIMITS.calls);
  });

  it("caps concurrent calls", async () => {
    const execute = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        toolCall: { id: "script-1/1" },
        isError: false,
        result: { content: [], details: {}, structuredContent: { total: 7 } },
      };
    });
    const { text } = await runScript(
      'const results = await Promise.allSettled(Array.from({length: 8}, () => tools.email_search({}))); return results.filter(r => r.status === "rejected").length;',
      execute,
    );
    expect(execute).toHaveBeenCalledTimes(CODEMODE_LIMITS.concurrent);
    expect(text).toContain("4");
  });

  it("requires meaningful independent organization searches to use bounded codemode batches", async () => {
    const source = await readFile("lib/agent-runtime.ts", "utf8");
    expect(source).toContain("you must run at least one codemode batch before rendering or updating the dashboard");
    expect(source).toContain(
      "use at least one codemode batch before dashboard edits instead of issuing all searches directly",
    );
    expect(source).toContain("Do not invent extra searches merely to use codemode");
    expect(source).toContain(
      "Check failures from Promise.allSettled rather than treating failed searches as zero matches",
    );
    expect(source).toContain(
      "Keep Flow suggestions, proposals, approval requests, memory writes, and dashboard edits as direct tools",
    );
    expect(source).toContain("retry a smaller batch or explain why direct read fallback is necessary");
  });

  it("wires only the trusted inline extension and retains nested history identities", async () => {
    const source = await readFile("lib/agent-runtime.ts", "utf8");
    expect(source).toContain("noExtensions: true");
    expect(source).toContain("extensionFactories: [readOnlyCodemodeExtension]");
    expect(source).toContain('noTools: "builtin"');
    expect(source).toContain("].map(withCodemodePolicy)");
    expect(source).toContain("await session.bindExtensions({})");
    expect(source).toContain("parent_tool_call_id: event.parentToolCallId");
  });
});
