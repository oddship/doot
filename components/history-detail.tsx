"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { WorkspaceBoundary } from "@/components/generated-workspace";
import { HistoryProposalAction } from "@/components/history-proposal-action";
import { LocalTime } from "@/components/local-time";
import { MarkdownContent } from "@/components/markdown-content";
import { Badge, Card, cn } from "@/components/ui";
import { apiJson } from "@/lib/client-api";
import { historyEventLabel } from "@/lib/history-display";
import { activityStatus, statusLabel, statusTone } from "@/lib/history-presentation";
import { useCacheEvents } from "@/lib/use-cache-events";

function stepLabel(step: any) {
  return (
    (
      {
        mark_read: "Mark read",
        mark_unread: "Mark unread",
        move: "Move message",
        archive: "Archive message",
        delete: "Delete message",
        sync: "Sync account",
        draft: "Upload draft",
        agent: "Agent turn",
        schedule: "Scheduled work",
        create: "Create folder",
        rename: "Rename folder",
      } as Record<string, string>
    )[step.action] || step.action
  );
}
export function HistoryDetailView({ initialData, initialProposal }: { initialData: any; initialProposal: any }) {
  const [data, setData] = useState(initialData);
  const [proposal, setProposal] = useState(initialProposal);
  const [refreshError, setRefreshError] = useState("");
  useCacheEvents((event) => {
    if (event.type !== "cache.refresh") return;
    void apiJson<any>(`/api/agent/sessions/${initialData.session.id}`, { cache: "no-store" })
      .then(async (next) => {
        setData(next);
        setRefreshError("");
        const source =
          next.job?.source?.proposal_id ||
          next.events.findLast((item: any) => item.metadata?.proposal_id)?.metadata.proposal_id;
        if (source) setProposal((await apiJson<any>(`/api/proposals/${source}`, { cache: "no-store" })).proposal);
      })
      .catch(() => setRefreshError("Connection interrupted. Showing saved results; retrying automatically."));
  });
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

  const jobAccounts = data.events.filter(
    (event: any) => event.event_type === "sync_account_complete" || event.event_type === "sync_account_error",
  );
  const hasSummary = isJob || !isAgent || Boolean(data.workspace);
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
          <Badge tone={statusTone(data.job?.status || activityStatus(data.session))}>
            {statusLabel(data.job?.status || activityStatus(data.session))}
          </Badge>
        </div>
      </header>
      {refreshError && (
        <p role="status" className="muted">
          {refreshError}
        </p>
      )}
      {data.job && (
        <Card className="history-outcome">
          <div className="event-head">
            <h2>Saved outcome</h2>
            <Badge tone={statusTone(data.job.status)}>{statusLabel(data.job.status)}</Badge>
          </div>
          <p className="muted">
            {data.job.completed} of {data.job.total} steps confirmed.{" "}
            {["queued", "running"].includes(data.job.status)
              ? "Work continues in the app. You can close this page."
              : ""}
          </p>
          <progress value={data.job.completed} max={data.job.total || 1} aria-label="Completed steps" />
          {data.job.error && (
            <p className="history-error-summary" role="status">
              {data.job.error}
            </p>
          )}
          {data.job.status === "needs_review" && (
            <p>Check the mailbox before making another attempt. Unconfirmed writes are never repeated automatically.</p>
          )}
          <details className="history-step-receipts" open={data.job.status !== "complete"}>
            <summary>{data.job.total} saved step receipts</summary>
            <ol className="history-step-list">
              {data.job.steps.map((step: any) => (
                <li key={step.position}>
                  <div>
                    <strong>{stepLabel(step)}</strong>
                    <span className="muted">
                      {[
                        step.account,
                        step.folder,
                        step.uid && `Message ${step.uid}`,
                        step.destination && `To ${step.destination}`,
                        step.title,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <Badge tone={statusTone(step.result?.errors?.length ? "error" : step.status)}>
                    {statusLabel(step.result?.errors?.length ? "error" : step.status)}
                  </Badge>
                  {(step.error || step.result?.errors?.length > 0) && (
                    <p className="history-error-summary">
                      {step.error || step.result.errors.map((item: any) => item.error).join("; ")}
                    </p>
                  )}
                  {step.result && (
                    <details>
                      <summary>Saved receipt</summary>
                      <pre>{JSON.stringify(step.result, null, 2)}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </details>
          <div className="history-source-links">
            {data.job.source?.flow_id && <Link href={`/flows/${data.job.source.flow_id}`}>Open Flow</Link>}
            {data.job.source?.draft_id && <Link href="/drafts">Open drafts</Link>}
          </div>
        </Card>
      )}
      <div className={cn("history-grid history-detail-layout", !hasSummary && "history-grid-single")}>
        <Card className="history-detail">
          <details className="history-execution-log">
            <summary>Execution log · {data.events.length} events</summary>
            {data.events.map((event: any) => (
              <div className="event" key={event.id}>
                <div className="event-head">
                  <strong>{historyEventLabel(event.event_type)}</strong>
                  <LocalTime value={event.created_at} display="time" />
                </div>
                {event.content &&
                  (["assistant_message", "reasoning"].includes(event.event_type) ? (
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
          </details>
        </Card>
        {hasSummary && (
          <Card className="history-detail">
            <h2>{isJob ? "Account results" : isAgent ? "Generated workspace" : "Activity summary"}</h2>
            {isJob ? (
              data.job ? (
                <p className="muted">Account results and saved receipts are shown above.</p>
              ) : jobAccounts.length ? (
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
                  <strong>{statusLabel(data.job?.status || activityStatus(data.session))}</strong>
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
                {proposal && <HistoryProposalAction key={`${proposal.id}:${proposal.status}`} proposal={proposal} />}
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
            ) : null}
          </Card>
        )}
      </div>
    </main>
  );
}
