"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LocalTime } from "@/components/local-time";
import { Badge, Card, Input } from "@/components/ui";
import { apiJson } from "@/lib/client-api";
import { navigateClient } from "@/lib/client-navigation";
import { createRefreshQueue } from "@/lib/client-refresh";
import { activityStatus, statusLabel, statusMatches, statusTone } from "@/lib/history-presentation";
import { useCacheEvents } from "@/lib/use-cache-events";

const kinds: Record<string, { label: string; detail: string; tone: string }> = {
  agent: { label: "Agent", detail: "Doot conversation", tone: "good" },
  job: { label: "Sync", detail: "Background sync job", tone: "attention" },
  flow: { label: "Flow", detail: "Flow definition or run", tone: "selected" },
  action: { label: "Action", detail: "Mailbox or review action", tone: "error" },
  schedule: { label: "Schedule", detail: "Schedule configuration", tone: "neutral" },
};

export function HistoryScreen({ sessions: initialSessions }: { sessions: any[] }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [refreshError, setRefreshError] = useState("");
  const refresh = useMemo(
    () =>
      createRefreshQueue(() =>
        apiJson<{ sessions: any[] }>("/api/agent/sessions", { cache: "no-store" })
          .then((value) => {
            setSessions(value.sessions);
            setRefreshError("");
          })
          .catch(() => setRefreshError("Connection interrupted. Showing saved activity; retrying automatically.")),
      ),
    [],
  );
  useCacheEvents((event) => {
    if (event.type === "cache.refresh" && ["all", "history"].includes(event.resource)) void refresh();
  });
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      sessions.filter(
        (session) =>
          (kind === "all" || session.history_kind === kind) &&
          statusMatches(activityStatus(session), status) &&
          (!query.trim() || String(session.title).toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [sessions, kind, status, query],
  );
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>History</h1>
          <p>Saved work, approvals, and outcomes. Tasks continue while the browser is closed.</p>
        </div>
        <Badge>{sessions.length} history entries</Badge>
      </header>
      {refreshError && (
        <p className="muted" role="status">
          {refreshError}
        </p>
      )}
      <div className="history-overview">
        {[
          { label: "In progress", filter: "in_progress", matches: ["queued", "running"] },
          { label: "Needs review", filter: "review", matches: ["ready", "needs_review"] },
          { label: "Failed", filter: "error", matches: ["error"] },
          { label: "Complete", filter: "complete", matches: ["complete"] },
        ].map((group) => (
          <button
            type="button"
            key={group.label}
            onClick={() => setStatus(group.filter)}
            aria-pressed={status === group.filter}
          >
            <strong>{sessions.filter((session) => group.matches.includes(activityStatus(session))).length}</strong>
            <span>{group.label}</span>
          </button>
        ))}
      </div>
      <Card className="history-filters">
        <fieldset className="history-kind-filters">
          <legend>History type</legend>
          {["all", ...Object.keys(kinds)].map((value) => (
            <button type="button" className={kind === value ? "active" : ""} key={value} onClick={() => setKind(value)}>
              {value === "all" ? "All" : kinds[value].label}
              <span>
                {value === "all" ? sessions.length : sessions.filter((item) => item.history_kind === value).length}
              </span>
            </button>
          ))}
        </fieldset>
        <div className="history-filter-fields">
          <Input value={query} placeholder="Filter by title" onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="History status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="in_progress">In progress</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="review">Needs review</option>
            <option value="needs_review">Outcome uncertain</option>
            <option value="ready">Awaiting approval</option>
            <option value="complete">Complete</option>
            <option value="error">Error</option>
          </select>
        </div>
      </Card>
      <Card className="session-list">
        {visible.length ? (
          visible.map((session: any) => {
            const type = kinds[session.history_kind] || kinds.action;
            return (
              <Link
                href={`/history/${session.id}`}
                className="session-link"
                key={session.id}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  navigateClient(`/history/${session.id}`);
                }}
              >
                <div className="session-title">
                  <strong>{session.title}</strong>
                  <Badge tone={type.tone}>{type.label}</Badge>
                </div>
                <span>
                  {session.job_kind ? `${session.job_kind} job` : type.detail} ·{" "}
                  {session.job_id
                    ? `${session.completed_steps}/${session.total_steps} steps completed`
                    : `${session.event_count} events`}
                </span>
                <Badge tone={statusTone(activityStatus(session))}>{statusLabel(activityStatus(session))}</Badge>
                {session.job_id && (
                  <progress
                    value={session.completed_steps}
                    max={session.total_steps || 1}
                    aria-label="Completed steps"
                  />
                )}
                {session.error && <small className="history-error-summary">{session.error}</small>}
                <span>{session.updated_at ? <LocalTime value={session.updated_at} /> : ""}</span>
              </Link>
            );
          })
        ) : (
          <div style={{ padding: 30, textAlign: "center" }} className="muted">
            No history entries match these filters.
          </div>
        )}
      </Card>
    </main>
  );
}
