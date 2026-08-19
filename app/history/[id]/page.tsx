import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { WorkspaceBoundary } from "@/components/generated-workspace";
import { LocalTime } from "@/components/local-time";
import { Badge, Card } from "@/components/ui";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export default async function HistoryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await store<any>(["session-get", id]);
  const isJob = data.session.history_kind === "job";
  const jobAccounts = data.events.filter(
    (event: any) => event.event_type === "sync_account_complete" || event.event_type === "sync_account_error",
  );
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <Link href="/history" className="muted">
            <ArrowLeft size={14} style={{ display: "inline" }} /> All history
          </Link>
          <h1 style={{ marginTop: 12 }}>{data.session.title}</h1>
          <p>
            {isJob
              ? "Background sync job"
              : `${data.session.model_provider || "Doot"} / ${data.session.model_id || "default"}`}{" "}
            · <LocalTime value={data.session.started_at} />
          </p>
        </div>
        <div className="history-badges">
          <Badge tone={isJob ? "attention" : "good"}>{isJob ? "Job" : "Doot"}</Badge>
          <Badge
            tone={data.session.status === "complete" ? "good" : data.session.status === "error" ? "error" : "attention"}
          >
            {data.session.status}
          </Badge>
        </div>
      </header>
      <div className="history-grid">
        <Card className="history-detail">
          <h2>Event replay</h2>
          {data.events.map((event: any) => (
            <div className="event" key={event.id}>
              <div className="event-head">
                <strong>{event.event_type.replaceAll("_", " ")}</strong>
                <LocalTime value={event.created_at} display="time" />
              </div>
              {event.content && <div className="event-content">{event.content}</div>}
              {Object.keys(event.metadata || {}).length > 0 && (
                <details>
                  <summary className="muted">Event metadata</summary>
                  <pre style={{ overflow: "auto", fontSize: 11 }}>{JSON.stringify(event.metadata, null, 2)}</pre>
                </details>
              )}
            </div>
          ))}
        </Card>
        <Card className="history-detail">
          <h2>{isJob ? "Account results" : "Generated workspace"}</h2>
          {isJob ? (
            jobAccounts.length ? (
              <div className="job-account-list">
                {jobAccounts.map((event: any) => (
                  <div className="account-row" key={event.id}>
                    <div>
                      <strong>{event.metadata?.email || event.metadata?.account || "Account"}</strong>
                      <div className="muted">{event.content}</div>
                    </div>
                    <Badge tone={event.event_type === "sync_account_complete" ? "good" : "error"}>
                      {event.event_type === "sync_account_complete" ? "Done" : "Failed"}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No account results were recorded.</p>
            )
          ) : data.workspace ? (
            <WorkspaceBoundary value={data.workspace.spec} />
          ) : (
            <p className="muted">This run did not produce a workspace.</p>
          )}
        </Card>
      </div>
    </main>
  );
}
