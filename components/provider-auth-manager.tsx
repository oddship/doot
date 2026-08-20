"use client";

import { Check, Clipboard, ExternalLink, KeyRound, LogIn, LogOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog, useToast } from "@/components/feedback";
import { Badge, Button, Card, Dialog, Input, Label } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";

type AuthMethod = { type: "api_key" | "oauth"; label: string; subscription?: boolean };
type Provider = {
  id: string;
  name: string;
  configured: boolean;
  credential_type?: "api_key" | "oauth";
  source?: string;
  methods: AuthMethod[];
};
type LoginPrompt = {
  id: string;
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: Array<{ id: string; label: string; description?: string }>;
};
type LoginEvent = {
  type: "info" | "auth_url" | "device_code" | "progress";
  message?: string;
  url?: string;
  instructions?: string;
  links?: Array<{ url: string; label?: string }>;
  userCode?: string;
  verificationUri?: string;
  expiresInSeconds?: number;
};
type LoginSession = {
  id: string;
  provider: string;
  provider_name: string;
  auth_type: "api_key" | "oauth";
  status: "running" | "waiting" | "complete" | "error" | "cancelled";
  events: LoginEvent[];
  prompt?: LoginPrompt;
  error?: string;
};

export function ProviderAuthManager({
  initialProviders,
  onModels,
}: {
  initialProviders: Provider[];
  onModels: (models: any[]) => void;
}) {
  const toast = useToast();
  const [providers, setProviders] = useState(initialProviders);
  const [providerId, setProviderId] = useState(
    initialProviders.find((provider) => provider.configured)?.id || initialProviders[0]?.id || "",
  );
  const [login, setLogin] = useState<LoginSession | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingLogout, setPendingLogout] = useState<Provider | null>(null);
  const provider = useMemo(() => providers.find((item) => item.id === providerId), [providers, providerId]);

  const refresh = async () => {
    const [auth, models] = await Promise.all([
      apiJson<{ providers: Provider[] }>("/api/agent/auth/providers"),
      apiJson<{ models: any[] }>("/api/agent/models"),
    ]);
    setProviders(auth.providers);
    onModels(models.models);
  };

  useEffect(() => {
    if (!login || ["complete", "error", "cancelled"].includes(login.status)) return;
    const timer = window.setTimeout(async () => {
      try {
        const next = await apiJson<LoginSession>(`/api/agent/auth/login/${login.id}`);
        setLogin(next);
        if (next.status === "complete") {
          await refresh();
          toast.success("Provider connected", `${next.provider_name} is ready for model selection.`);
        }
      } catch (error) {
        toast.error("Login status unavailable", errorMessage(error));
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [login]);

  useEffect(() => setAnswer(""), [login?.prompt?.id]);

  const start = async (method: AuthMethod) => {
    if (!provider) return;
    setBusy(true);
    try {
      const session = await apiJson<LoginSession>("/api/agent/auth/login", {
        method: "POST",
        json: { provider: provider.id, auth_type: method.type },
      });
      setLogin(session);
    } catch (error) {
      toast.error("Could not start login", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const respond = async (value = answer) => {
    if (!login?.prompt) return;
    setBusy(true);
    try {
      setLogin(
        await apiJson<LoginSession>(`/api/agent/auth/login/${login.id}`, {
          method: "POST",
          json: { prompt_id: login.prompt.id, value },
        }),
      );
      setAnswer("");
    } catch (error) {
      toast.error("Could not continue login", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!login) return setLogin(null);
    if (!["complete", "error", "cancelled"].includes(login.status))
      await apiJson(`/api/agent/auth/login/${login.id}`, { method: "DELETE" }).catch(() => undefined);
    setLogin(null);
  };

  const logout = async () => {
    if (!pendingLogout) return;
    setBusy(true);
    try {
      await apiJson(`/api/agent/auth/providers/${pendingLogout.id}`, {
        method: "DELETE",
        json: { confirm: true },
      });
      setPendingLogout(null);
      await refresh();
      toast.success("Provider signed out");
    } catch (error) {
      toast.error("Could not sign out", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const latestUrl = [...(login?.events || [])].reverse().find((event) => event.type === "auth_url");
  const device = [...(login?.events || [])].reverse().find((event) => event.type === "device_code");

  return (
    <Card className="settings-section provider-auth" id="provider">
      <div className="node-title-row">
        <div>
          <h2>Model providers</h2>
          <p className="muted">Choose a provider, then use its supported sign-in method.</p>
        </div>
        <Badge tone={providers.some((item) => item.configured) ? "good" : "attention"}>
          {providers.filter((item) => item.configured).length} connected
        </Badge>
      </div>
      <div className="provider-connect-row">
        <div>
          <Label>Provider</Label>
          <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.configured ? " · connected" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="provider-methods">
          {provider?.methods.map((method) => (
            <Button
              key={method.type}
              variant={method.type === "oauth" ? "default" : "outline"}
              tooltip={method.type === "oauth" ? "Open provider sign-in flow" : "Store provider key locally"}
              disabled={busy}
              onClick={() => void start(method)}
            >
              {method.type === "oauth" ? <LogIn size={14} /> : <KeyRound size={14} />}
              {method.label}
            </Button>
          ))}
        </div>
      </div>
      {providers.some((item) => item.configured) && (
        <div className="provider-list">
          {providers
            .filter((item) => item.configured)
            .map((item) => (
              <div className="provider-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.credential_type === "oauth" ? "OAuth" : "API key"}
                    {item.source ? ` · ${item.source}` : ""}
                  </span>
                </div>
                <Badge tone="good">
                  <Check size={12} /> Connected
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  tooltip="Remove this model credential"
                  onClick={() => setPendingLogout(item)}
                >
                  <LogOut size={13} /> Sign out
                </Button>
              </div>
            ))}
        </div>
      )}
      <Dialog
        open={Boolean(login)}
        title={login ? `Connect ${login.provider_name}` : "Connect provider"}
        onClose={cancel}
      >
        {login && (
          <div className="provider-login-dialog">
            <div className="provider-login-status">
              <Badge tone={login.status === "complete" ? "good" : login.status === "error" ? "error" : "attention"}>
                {login.status}
              </Badge>
              <span>{login.auth_type === "oauth" ? "OAuth sign-in" : "API-key setup"}</span>
            </div>
            {login.events.map((event, index) => (
              <div className="provider-auth-event" key={`${event.type}-${index}`}>
                {event.type === "device_code" ? (
                  <>
                    <span>Enter this one-time code</span>
                    <strong className="device-code">{event.userCode}</strong>
                  </>
                ) : (
                  <span>{event.message || event.instructions}</span>
                )}
              </div>
            ))}
            {(latestUrl?.url || device?.verificationUri) && (
              <div className="provider-login-actions">
                <a
                  className="button button-default"
                  href={latestUrl?.url || device?.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} /> Open provider sign-in
                </a>
                {device?.userCode && (
                  <Button
                    variant="outline"
                    tooltip="Copy the one-time login code"
                    onClick={() => {
                      void navigator.clipboard.writeText(device.userCode || "");
                      toast.info("Device code copied");
                    }}
                  >
                    <Clipboard size={14} /> Copy code
                  </Button>
                )}
              </div>
            )}
            {login.prompt?.type === "select" && (
              <div className="provider-login-options">
                <Label>{login.prompt.message}</Label>
                {login.prompt.options?.map((option) => (
                  <Button
                    key={option.id}
                    variant="outline"
                    tooltip={option.description || "Use this login method"}
                    disabled={busy}
                    onClick={() => void respond(option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}
            {login.prompt && login.prompt.type !== "select" && (
              <div>
                <Label>{login.prompt.message}</Label>
                <div className="provider-answer-row">
                  <Input
                    type={login.prompt.type === "secret" ? "password" : "text"}
                    autoComplete="off"
                    placeholder={login.prompt.placeholder}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && void respond()}
                  />
                  <Button
                    tooltip="Continue provider login"
                    disabled={busy || (!answer && login.prompt.type !== "text")}
                    onClick={() => void respond()}
                  >
                    Continue
                  </Button>
                </div>
                {login.prompt.type === "manual_code" && (
                  <p className="muted">
                    If the provider redirects to an unreachable localhost page, copy that page’s complete URL from the
                    address bar and paste it here.
                  </p>
                )}
              </div>
            )}
            {login.status === "running" && !login.prompt && <p className="muted">Waiting for the provider…</p>}
            {login.status === "complete" && <p>Connected. You can now select an available model below.</p>}
            {login.error && <p className="error-text">{login.error}</p>}
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={Boolean(pendingLogout)}
        title={`Sign out of ${pendingLogout?.name || "provider"}?`}
        description={<p>The stored token or API key will be removed. Email accounts and cached mail are unaffected.</p>}
        confirmLabel="Sign out"
        dangerous
        busy={busy}
        onConfirm={() => void logout()}
        onClose={() => setPendingLogout(null)}
      />
    </Card>
  );
}
