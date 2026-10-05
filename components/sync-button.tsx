"use client";
import { LoaderCircle } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/feedback";
import { Button } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";

type SyncAccount = { status: "waiting" | "syncing" | "done" | "error"; error?: string };
type SyncJob = { id: string | null; status: "idle" | "running" | "done"; accounts: SyncAccount[] };

export function SyncButton({ icon }: { icon: ReactNode }) {
  const toast = useToast();
  const [status, setStatus] = useState<SyncJob["status"] | "starting" | "error">("idle");
  const [detail, setDetail] = useState("");
  const [failure, setFailure] = useState("");
  const busy = useRef(false);
  const version = useRef(0);
  const watchedJob = useRef<string | null>(null);
  const notifiedJob = useRef<string | null>(null);

  const showJob = useCallback(
    (job: SyncJob, requested = false) => {
      // A slow POST/poll response must not resurrect a job already completed via WebSocket.
      if (job.id && notifiedJob.current === job.id && job.status === "running") return;
      version.current++;
      busy.current = job.status === "running";
      const completed = job.accounts.filter(
        (account) => account.status === "done" || account.status === "error",
      ).length;
      const failed = job.accounts.filter((account) => account.status === "error");
      setStatus(job.status);
      setDetail(job.accounts.length ? `${completed}/${job.accounts.length}` : "");
      const errors = failed.map((account) => account.error || "An account could not be synced").join("; ");
      setFailure(errors);
      if (job.status === "running" || requested) watchedJob.current = job.id;
      // Don't announce old completed jobs on mount, or repeat WebSocket/poll notifications.
      if (job.status === "done" && job.id && watchedJob.current === job.id && notifiedJob.current !== job.id) {
        notifiedJob.current = job.id;
        if (!job.accounts.length) toast.info("No accounts to sync", "Connect an email account in Settings first.");
        else if (failed.length)
          toast.error(
            "Mail sync finished with errors",
            `${failed.length}/${job.accounts.length} accounts failed. ${errors} See History for details.`,
          );
        else toast.success("Mail synced", `${job.accounts.length} account(s) synced. View details in History.`);
      }
    },
    [toast],
  );

  const sync = useCallback(
    async (manual = true) => {
      if (busy.current) return;
      busy.current = true;
      version.current++;
      setStatus("starting");
      setDetail("");
      setFailure("");
      if (manual)
        toast.info(
          "Starting mail sync",
          "Fetching new message headers. You can keep browsing; progress is recorded in History.",
        );
      try {
        showJob(await apiJson<SyncJob>("/api/sync", { method: "POST" }, "Could not start sync"), true);
      } catch (error) {
        busy.current = false;
        version.current++;
        const message = errorMessage(error, "Could not start sync");
        setStatus("error");
        setFailure(message);
        toast.error("Could not start mail sync", message);
      }
    },
    [showJob, toast],
  );

  useEffect(() => {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    socket.onmessage = (event) => {
      try {
        const value = JSON.parse(event.data);
        if (value.type === "sync.status") showJob(value.job);
      } catch {
        // Ignore malformed/unrelated frames; HTTP polling recovers sync progress.
      }
    };
    let mounted = true;
    const initialVersion = version.current;
    void apiJson<SyncJob>("/api/sync", { cache: "no-store" })
      .then((job) => {
        if (mounted && version.current === initialVersion) showJob(job);
      })
      .catch(() => {});
    if (!sessionStorage.getItem("email-agent-start-sync")) {
      sessionStorage.setItem("email-agent-start-sync", "checked");
      void apiJson<any>("/api/settings")
        .then((value) => {
          if (mounted && value.settings?.sync_on_start) return sync(false);
        })
        .catch(() => {});
    }
    return () => {
      mounted = false;
      socket.close();
    };
  }, [showJob, sync]);

  useEffect(() => {
    if (status !== "running") return;
    let mounted = true;
    let pending = false;
    const timer = window.setInterval(async () => {
      if (pending) return;
      pending = true;
      const readVersion = version.current;
      try {
        const job = await apiJson<SyncJob>("/api/sync", { cache: "no-store" });
        if (mounted && version.current === readVersion) showJob(job);
      } catch {
        // A transient connection error should not claim the background job failed.
      } finally {
        pending = false;
      }
    }, 5_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [status, showJob]);

  const failed = Boolean(failure);
  const isBusy = status === "starting" || status === "running";
  const label =
    status === "starting"
      ? "Starting sync…"
      : status === "running"
        ? `Syncing${detail ? ` ${detail}` : "…"}`
        : status === "done"
          ? failed
            ? `Sync failed ${detail}`
            : `Synced${detail ? ` ${detail}` : ""}`
          : status === "error"
            ? "Sync failed"
            : "Sync mail";
  return (
    <Button
      variant={failed ? "danger" : "outline"}
      size="sm"
      onClick={() => void sync()}
      disabled={isBusy}
      aria-busy={isBusy}
      aria-label={label}
      title={failure || undefined}
      tooltip={
        failure || (isBusy ? "Sync continues in the background; see History for details" : "Fetch new message headers")
      }
      tooltipAlign="right"
    >
      {isBusy ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : icon}
      <span className="sync-label" aria-live="polite">
        {label}
      </span>
    </Button>
  );
}
