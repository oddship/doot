import { randomUUID } from "node:crypto";
import { getAgentModelRuntime } from "@/lib/agent-runtime";
import { startHistory } from "@/lib/history";
import { emitBackground } from "@/lib/store";

type AuthType = "api_key" | "oauth";
type PublicPrompt = {
  id: string;
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: Array<{ id: string; label: string; description?: string }>;
};
type PublicEvent =
  | { type: "info"; message: string; links?: Array<{ url: string; label?: string }> }
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "progress"; message: string };
type LoginSession = {
  id: string;
  provider: string;
  providerName: string;
  authType: AuthType;
  status: "running" | "waiting" | "complete" | "error" | "cancelled";
  events: PublicEvent[];
  prompt?: PublicPrompt;
  resolvePrompt?: (value: string) => void;
  rejectPrompt?: (error: Error) => void;
  controller: AbortController;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const loginSessions = new Map<string, LoginSession>();
const LOGIN_TTL = 20 * 60_000;

function cleanSessions() {
  const cutoff = Date.now() - LOGIN_TTL;
  for (const [id, session] of loginSessions) {
    if (session.updatedAt >= cutoff) continue;
    if (session.status === "running" || session.status === "waiting") session.controller.abort("Login expired");
    loginSessions.delete(id);
  }
}

function safeExternalUrl(value: unknown) {
  const url = new URL(String(value || ""));
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error("Provider returned an unsafe login URL");
  return url.toString();
}

function publicSession(session: LoginSession) {
  return {
    id: session.id,
    provider: session.provider,
    provider_name: session.providerName,
    auth_type: session.authType,
    status: session.status,
    events: session.events,
    prompt: session.prompt,
    error: session.error,
    created_at: new Date(session.createdAt).toISOString(),
    updated_at: new Date(session.updatedAt).toISOString(),
  };
}

function getSession(id: string) {
  cleanSessions();
  const session = loginSessions.get(id);
  if (!session) throw new Error("login session not found or expired");
  return session;
}

function notify(session: LoginSession, event: any) {
  let safe: PublicEvent;
  if (event.type === "auth_url") {
    safe = { type: "auth_url", url: safeExternalUrl(event.url), instructions: String(event.instructions || "") };
  } else if (event.type === "device_code") {
    safe = {
      type: "device_code",
      userCode: String(event.userCode || ""),
      verificationUri: safeExternalUrl(event.verificationUri),
      intervalSeconds: Number(event.intervalSeconds) || undefined,
      expiresInSeconds: Number(event.expiresInSeconds) || undefined,
    };
  } else if (event.type === "info") {
    safe = {
      type: "info",
      message: String(event.message || ""),
      links: Array.isArray(event.links)
        ? event.links
            .slice(0, 10)
            .map((link: any) => ({ url: safeExternalUrl(link.url), label: String(link.label || "") }))
        : undefined,
    };
  } else {
    safe = { type: "progress", message: String(event.message || "Working…") };
  }
  session.events = [...session.events.slice(-19), safe];
  session.updatedAt = Date.now();
  emitBackground({ type: "cache.refresh", resource: "provider-auth", login_id: session.id });
}

export async function listProviderAuth() {
  const runtime = await getAgentModelRuntime();
  const credentials = new Map((await runtime.listCredentials()).map((item: any) => [item.providerId, item.type]));
  return {
    providers: runtime
      .getProviders()
      .filter((provider: any) => provider.auth?.apiKey?.login || provider.auth?.oauth)
      .map((provider: any) => {
        const status = runtime.getProviderAuthStatus(provider.id);
        return {
          id: provider.id,
          name: provider.name || provider.id,
          configured: Boolean(status.configured),
          credential_type: credentials.get(provider.id) || (runtime.isUsingOAuth(provider.id) ? "oauth" : undefined),
          source: status.label || status.source,
          methods: [
            ...(provider.auth?.apiKey?.login
              ? [{ type: "api_key", label: provider.auth.apiKey.name || "Use an API key" }]
              : []),
            ...(provider.auth?.oauth
              ? [
                  {
                    type: "oauth",
                    label: provider.auth.oauth.loginLabel || provider.auth.oauth.name || "Sign in with OAuth",
                    subscription: Boolean(provider.auth.oauth.isSubscription),
                  },
                ]
              : []),
          ],
        };
      }),
  };
}

export async function startProviderLogin(providerId: string, authType: AuthType) {
  cleanSessions();
  const runtime = await getAgentModelRuntime();
  const provider: any = runtime.getProvider(providerId);
  if (!provider) throw new Error("provider not found");
  if (authType === "api_key" && !provider.auth?.apiKey?.login)
    throw new Error("provider does not support API-key login");
  if (authType === "oauth" && !provider.auth?.oauth) throw new Error("provider does not support OAuth login");
  for (const session of loginSessions.values()) {
    if (session.provider === providerId && ["running", "waiting"].includes(session.status))
      session.controller.abort("Replaced by a new login");
  }
  const timestamp = Date.now();
  const session: LoginSession = {
    id: randomUUID(),
    provider: providerId,
    providerName: provider.name || providerId,
    authType,
    status: "running",
    events: [],
    controller: new AbortController(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  loginSessions.set(session.id, session);
  void runtime
    .login(providerId, authType, {
      signal: session.controller.signal,
      notify: (event: any) => notify(session, event),
      prompt: (prompt: any) =>
        new Promise<string>((resolve, reject) => {
          const promptId = randomUUID();
          const publicPrompt: PublicPrompt = {
            id: promptId,
            type: prompt.type,
            message: String(prompt.message || "Enter the requested value"),
            placeholder: prompt.placeholder ? String(prompt.placeholder) : undefined,
            options: Array.isArray(prompt.options)
              ? prompt.options.map((option: any) => ({
                  id: String(option.id),
                  label: String(option.label),
                  description: option.description ? String(option.description) : undefined,
                }))
              : undefined,
          };
          session.prompt = publicPrompt;
          session.resolvePrompt = resolve;
          session.rejectPrompt = reject;
          session.status = "waiting";
          session.updatedAt = Date.now();
          const abort = () => reject(new Error("Login cancelled"));
          prompt.signal?.addEventListener("abort", abort, { once: true });
          session.controller.signal.addEventListener("abort", abort, { once: true });
          emitBackground({ type: "cache.refresh", resource: "provider-auth", login_id: session.id });
        }),
    })
    .then(() => {
      session.prompt = undefined;
      session.resolvePrompt = undefined;
      session.rejectPrompt = undefined;
      session.status = "complete";
      session.updatedAt = Date.now();
      startHistory({
        kind: "action",
        title: `Connected model provider · ${session.providerName}`,
        event_type: "provider_authenticated",
        content: `${session.authType === "oauth" ? "OAuth" : "API-key"} credentials were stored locally and redacted.`,
        metadata: { provider: session.provider, auth_type: session.authType },
      });
      emitBackground({ type: "cache.refresh", resource: "provider-auth", login_id: session.id });
    })
    .catch((error: any) => {
      session.prompt = undefined;
      session.resolvePrompt = undefined;
      session.rejectPrompt = undefined;
      session.status = session.controller.signal.aborted ? "cancelled" : "error";
      session.error = session.controller.signal.aborted ? "Login cancelled" : String(error?.message || error);
      session.updatedAt = Date.now();
      emitBackground({ type: "cache.refresh", resource: "provider-auth", login_id: session.id });
    });
  return publicSession(session);
}

export function getProviderLogin(id: string) {
  return publicSession(getSession(id));
}

export function respondToProviderLogin(id: string, promptId: string, value: string) {
  const session = getSession(id);
  if (!session.prompt || session.prompt.id !== promptId || !session.resolvePrompt)
    throw new Error("login prompt is no longer active");
  const resolve = session.resolvePrompt;
  session.prompt = undefined;
  session.resolvePrompt = undefined;
  session.rejectPrompt = undefined;
  session.status = "running";
  session.updatedAt = Date.now();
  resolve(String(value || ""));
  return publicSession(session);
}

export function cancelProviderLogin(id: string) {
  const session = getSession(id);
  session.controller.abort("Cancelled by user");
  session.status = "cancelled";
  session.error = "Login cancelled";
  session.updatedAt = Date.now();
  return publicSession(session);
}

export async function logoutProvider(providerId: string) {
  const runtime = await getAgentModelRuntime();
  await runtime.logout(providerId);
  startHistory({
    kind: "action",
    title: `Signed out model provider · ${providerId}`,
    event_type: "provider_signed_out",
    content: "Removed the locally stored model credential.",
    metadata: { provider: providerId },
  });
  emitBackground({ type: "cache.refresh", resource: "provider-auth" });
  return { provider: providerId, configured: false };
}
