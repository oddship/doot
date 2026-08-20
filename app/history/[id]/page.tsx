import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { WorkspaceBoundary } from "@/components/generated-workspace";
import { HistoryProposalAction } from "@/components/history-proposal-action";
import { LocalTime } from "@/components/local-time";
import { MarkdownContent } from "@/components/markdown-content";
import { Badge, Card } from "@/components/ui";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export default async function HistoryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await store<any>(["session-get", id]);
  const isJob = data.session.history_kind === "job";
  const isAgent = data.session.history_kind === "agent";
  const kindLabel: Record<string, string> = {
    agent: "Agent",
    job: "Sync job",
    flow: "Flow",
    action: "Action",
    schedule: "Schedule",
  };
  const metadata = Object.assign({}, ...data.events.map((event: any) => event.metadata || {}));
  const proposal = metadata.proposal_id
    ? await store<any>(["action-get", String(metadata.proposal_id)]).catch(() => null)
    : null;
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
              : isAgent
                ? `${data.session.model_provider || "Doot"} / ${data.session.model_id || "default"}`
                : kindLabel[data.session.history_kind] || "Activity"}{" "}
            · <LocalTime value={data.session.started_at} />
          </p>
        </div>
        <div className="history-badges">
          <Badge tone={isJob ? "attention" : isAgent ? "good" : "selected"}>
            {kindLabel[data.session.history_kind] || "Activity"}
          </Badge>
          <Badge
            tone={data.session.status === "complete" ? "good" : data.session.status === "error" ? "error" : "attention"}
          >
            {data.session.status === "ready" ? "Needs review" : data.session.status}
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
              {event.content &&
                (event.event_type === "assistant_message" ? (
                  <MarkdownContent>{event.content}</MarkdownContent>
                ) : (
                  <div className="event-content">{event.content}</div>
                ))}
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
          <h2>{isJob ? "Account results" : isAgent ? "Generated workspace" : "Activity summary"}</h2>
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
          ) : isAgent && data.workspace ? (
            <WorkspaceBoundary value={data.workspace.spec} />
          ) : !isAgent ? (
            <div className="activity-summary">
              <div>
                <span>Type</span>
                <strong>{kindLabel[data.session.history_kind] || data.session.history_kind}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{data.session.status === "ready" ? "Needs review" : data.session.status}</strong>
              </div>
              {metadata.flow_id && (
                <div>
                  <span>Flow</span>
                  <Link href={`/flows/${metadata.flow_id}`}>Open Flow {metadata.flow_id}</Link>
                </div>
              )}
              {metadata.proposal_id && (
                <div>
                  <span>Proposal</span>
                  <strong>#{metadata.proposal_id}</strong>
                </div>
              )}
              {proposal && <HistoryProposalAction proposal={proposal} />}
              {metadata.schedule_id && (
                <div>
                  <span>Schedule</span>
                  <strong>#{metadata.schedule_id}</strong>
                </div>
              )}
              <p className="muted">
                {data.session.status === "ready"
                  ? "This activity prepared a review item. No mailbox change was applied automatically."
                  : "This record is read-only and retained as part of the local activity ledger."}
              </p>
            </div>
          ) : (
            <p className="muted">This run did not produce a workspace.</p>
          )}
        </Card>
      </div>
    </main>
  );
}
