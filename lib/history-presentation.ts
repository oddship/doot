export function activityStatus(session: any) {
  return session.job_status || session.status;
}
export function statusLabel(status: string) {
  return (
    (
      {
        queued: "Queued",
        running: "Running",
        ready: "Awaiting approval",
        needs_review: "Outcome uncertain",
        complete: "Complete",
        error: "Failed",
        cancelled: "Cancelled",
      } as Record<string, string>
    )[status] || status
  );
}
export function statusTone(status: string) {
  return status === "complete" ? "good" : ["error", "needs_review"].includes(status) ? "error" : "attention";
}
export function statusMatches(status: string, filter: string) {
  return (
    filter === "all" ||
    (filter === "review"
      ? ["ready", "needs_review"].includes(status)
      : filter === "in_progress"
        ? ["queued", "running"].includes(status)
        : status === filter)
  );
}
