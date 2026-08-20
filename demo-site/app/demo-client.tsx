"use client";

import { useLayoutEffect, useState } from "react";
import { AppHeader } from "../../components/app-header";
import { DraftsClient } from "../../components/drafts-client";
import { FeedbackProvider } from "../../components/feedback";
import { HistoryScreen } from "../../components/history-screen";
import { InboxClient } from "../../components/inbox-client";
import { RulesClient } from "../../components/rules-client";
import { SettingsClient } from "../../components/settings-client";
import { WorkspaceClient, type WorkspaceEntry } from "../../components/workspace-client";
import { CLIENT_NAVIGATION_EVENT } from "../../lib/client-navigation";

type Json = Record<string, any>;
export type DemoFixtures = {
  conversation: Json;
  drafts: Json;
  flows: Json;
  history: Json;
  message: Json;
  messages: Json;
  settings: Json;
  workspace: Json;
};

function response(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function frozenFetch(fixtures: DemoFixtures): typeof window.fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.origin);
    const method = String(init?.method || request?.method || "GET").toUpperCase();
    const path = url.pathname;

    if (path === "/api/workspaces/latest") return response(fixtures.workspace);
    if (path === "/api/drafts" && method === "GET") return response(fixtures.drafts);
    if (path === "/api/drafts" && method === "POST") return response({ draft: fixtures.drafts.drafts[0] }, 201);
    if (/^\/api\/drafts\/\d+$/.test(path) && method === "PUT") {
      const content = JSON.parse(String(init?.body || "{}"));
      return response({ draft: { ...fixtures.drafts.drafts[0], title: content.subject || "Untitled draft", content } });
    }
    if (/^\/api\/drafts\/\d+\/save$/.test(path) && method === "POST")
      return response({ draft: { ...fixtures.drafts.drafts[0], status: "saved" }, imap: { folder: "Drafts" } });
    if (/^\/api\/drafts\/\d+$/.test(path) && method === "DELETE") return response({ deleted: 7 });
    if (path === "/api/schedules" && method === "GET") {
      const schedules = fixtures.flows.schedules.filter(
        (item: Json) =>
          (!url.searchParams.get("kind") || item.kind === url.searchParams.get("kind")) &&
          (!url.searchParams.get("rule_id") || item.rule_id === Number(url.searchParams.get("rule_id"))),
      );
      return response({ schedules });
    }
    if (path === "/api/schedules" && method === "POST") return response({ schedule: fixtures.flows.schedules[0] }, 201);
    if (/^\/api\/schedules\/\d+$/.test(path) && method === "PUT")
      return response({ schedule: fixtures.flows.schedules[0] });
    if (/^\/api\/schedules\/\d+$/.test(path) && method === "DELETE") return response({ deleted: 3 });
    if (path === "/api/agent/sessions") return response({ sessions: [] });
    if (path === "/api/agent/auth/providers" && method === "GET")
      return response({ providers: fixtures.settings.providers });
    if (path === "/api/agent/models" && method === "GET") return response({ models: fixtures.settings.models });
    if (path === "/api/messages") return response(fixtures.messages);
    if (path === "/api/message") return response(fixtures.message);
    if (/^\/api\/rules\/\d+\/preview$/.test(path)) {
      const id = path.split("/")[3];
      return response(fixtures.flows.previews[id] || { total: 0, messages: [] });
    }
    if (path === "/api/agent/memory" && method === "GET") {
      return url.searchParams.has("namespace")
        ? response({ items: fixtures.settings.memoryItems })
        : response({ namespaces: fixtures.settings.memoryNamespaces });
    }
    if (/^\/api\/accounts\/[^/]+\/folders$/.test(path) && method === "GET") {
      const account = decodeURIComponent(path.split("/")[3]);
      const provider = fixtures.settings.accounts.find((item: Json) => item.name === account)?.provider || "imap";
      return response({
        provider,
        folders: fixtures.settings.folders.filter((folder: Json) => folder.account === account),
      });
    }
    if (path === "/api/accounts" && method === "GET") return response({ accounts: fixtures.settings.accounts });
    if (path === "/api/settings" && method === "GET") return response({ settings: fixtures.settings.settings });
    if (path === "/api/sync" && method === "GET") return response({ status: "idle", accounts: [] });
    if (path === "/api/sync" && method === "POST") {
      return response({ status: "done", accounts: [{ status: "done" }, { status: "done" }] });
    }
    if (path === "/api/chat" && method === "POST") {
      const body = [
        { type: "start", messageMetadata: { sessionId: "demo-session-new" } },
        { type: "data-status", data: { status: "running", detail: "Inspecting the frozen inbox…" } },
        {
          type: "text-delta",
          delta: "I reviewed the frozen headers and refreshed this workspace without changing mail.",
        },
        { type: "data-workspace", data: { spec: fixtures.workspace.workspace.spec } },
        { type: "data-status", data: { status: "complete", detail: "Doot finished · demo data unchanged" } },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      return new Response(`${body}data: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }
    return response(
      { error: "This is a frozen demo. The review UI is real, but persistence and mailbox writes are disabled." },
      409,
    );
  };
}

class FrozenWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly readyState = 1;
  readonly url: string;
  readonly protocol = "";
  readonly extensions = "";
  readonly bufferedAmount = 0;
  readonly binaryType = "blob" as BinaryType;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  constructor(url: string | URL) {
    super();
    this.url = String(url);
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }
  close() {}
  send() {}
}

function viewPath(path: string) {
  if (path.startsWith("/inbox")) return "/inbox";
  if (path.startsWith("/drafts")) return "/drafts";
  if (path.startsWith("/flows") || path.startsWith("/rules")) return "/flows";
  if (path.startsWith("/history")) return "/history";
  if (path.startsWith("/settings")) return "/settings";
  return "/";
}

export function DemoClient({ fixtures }: { fixtures: DemoFixtures }) {
  const [ready, setReady] = useState(false);
  const [path, setPath] = useState("/");
  const basePath = process.env.NEXT_PUBLIC_DOOT_DEMO_BASE_PATH || "";

  useLayoutEffect(() => {
    const originalFetch = window.fetch;
    const OriginalWebSocket = window.WebSocket;
    window.fetch = frozenFetch(fixtures);
    window.WebSocket = FrozenWebSocket as unknown as typeof WebSocket;
    localStorage.setItem("email-agent:selected-messages:v1", JSON.stringify(fixtures.conversation.selected_ids));
    sessionStorage.setItem("email-agent-start-sync", "checked");
    const navigate = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<{ path: string }>;
      event.preventDefault();
      setPath(viewPath(event.detail.path));
    };
    window.addEventListener(CLIENT_NAVIGATION_EVENT, navigate);
    setReady(true);
    return () => {
      window.fetch = originalFetch;
      window.WebSocket = OriginalWebSocket;
      window.removeEventListener(CLIENT_NAVIGATION_EVENT, navigate);
    };
  }, [fixtures]);

  if (!ready) return <div className="demo-loading">Preparing frozen Doot responses…</div>;

  const current = viewPath(path);
  return (
    <FeedbackProvider>
      <div className="demo-notice">
        <strong>Interactive demo</strong>
        <span>Production screens · fictional frozen responses · no account, network service, or mailbox access</span>
      </div>
      <AppHeader
        activePath={current}
        onNavigate={(next) => setPath(viewPath(next))}
        logoPath={`${basePath}/doot-mark.svg`}
      />
      <div className="demo-main" data-demo-view={current.slice(1) || "workspace"}>
        {current === "/" && (
          <WorkspaceClient
            initialWorkspace={fixtures.workspace.workspace.spec}
            initialEntries={fixtures.conversation.entries as WorkspaceEntry[]}
            initialModel={{
              provider: fixtures.settings.settings.agent_provider,
              id: fixtures.settings.settings.agent_model,
              name: fixtures.settings.models.find(
                (model: Json) =>
                  model.provider === fixtures.settings.settings.agent_provider &&
                  model.id === fixtures.settings.settings.agent_model,
              )?.name,
            }}
            backgroundUpdates={false}
          />
        )}
        {current === "/inbox" && (
          <InboxClient
            accounts={fixtures.flows.accounts}
            initial={fixtures.messages}
            initialAccount="all"
            initialOpenUid="8102"
            initialLimit={25}
          />
        )}
        {current === "/drafts" && (
          <DraftsClient initialDrafts={fixtures.drafts.drafts} accounts={fixtures.flows.accounts} initialFocus={7} />
        )}
        {current === "/flows" && (
          <RulesClient
            initialRules={fixtures.flows.rules}
            accounts={fixtures.flows.accounts}
            folders={fixtures.flows.folders}
            initialFocus={12}
          />
        )}
        {current === "/history" && <HistoryScreen sessions={fixtures.history.sessions} />}
        {current === "/settings" && <SettingsClient initial={fixtures.settings} />}
      </div>
    </FeedbackProvider>
  );
}
