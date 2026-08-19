"use client";

import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { Badge, Card } from "@/components/ui";
import { navigateClient } from "@/lib/client-navigation";

export function HistoryScreen({ sessions }: { sessions: any[] }) {
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>History</h1>
          <p>
            Read-only Doot interactions and background jobs survive restarts. Completed runs are intentionally not
            resumable.
          </p>
        </div>
        <Badge>{sessions.length} history entries</Badge>
      </header>
      <Card className="session-list">
        {sessions.length ? (
          sessions.map((session: any) => (
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
                <Badge tone={session.history_kind === "job" ? "attention" : "good"}>
                  {session.history_kind === "job" ? "Job" : "Doot"}
                </Badge>
              </div>
              <span>
                {session.history_kind === "job"
                  ? "Background sync"
                  : `${session.model_provider || "Doot"} / ${session.model_id || "default"}`}{" "}
                · {session.status} · {session.event_count} events
              </span>
              <span>{session.updated_at ? <LocalTime value={session.updated_at} /> : ""}</span>
            </Link>
          ))
        ) : (
          <div style={{ padding: 30, textAlign: "center" }} className="muted">
            No Doot interactions or background jobs yet.
          </div>
        )}
      </Card>
    </main>
  );
}
