"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LocalTime } from "@/components/local-time";
import { Badge, Card, Input } from "@/components/ui";
import { navigateClient } from "@/lib/client-navigation";

const kinds: Record<string, { label: string; detail: string; tone: string }> = {
  agent: { label: "Agent", detail: "Doot conversation", tone: "good" },
  job: { label: "Sync", detail: "Background sync job", tone: "attention" },
  flow: { label: "Flow", detail: "Flow definition or run", tone: "selected" },
  action: { label: "Action", detail: "Mailbox or review action", tone: "error" },
  schedule: { label: "Schedule", detail: "Schedule configuration", tone: "neutral" },
};

export function HistoryScreen({ sessions }: { sessions: any[] }) {
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      sessions.filter(
        (session) =>
          (kind === "all" || session.history_kind === kind) &&
          (status === "all" || session.status === status) &&
          (!query.trim() || String(session.title).toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [sessions, kind, status, query],
  );
  return (
    <main className="page">
      <header className="page-head">
        <h1>History</h1>
        <Badge>{sessions.length} history entries</Badge>
      </header>
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
            <option value="running">Running</option>
            <option value="ready">Needs review</option>
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
                  event.preventDefault();
                  navigateClient(`/history/${session.id}`);
                }}
              >
                <div className="session-title">
                  <strong>{session.title}</strong>
                  <Badge tone={type.tone}>{type.label}</Badge>
                </div>
                <span>
                  {type.detail} · {session.status === "ready" ? "needs review" : session.status} · {session.event_count}{" "}
                  event{session.event_count === 1 ? "" : "s"}
                </span>
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
