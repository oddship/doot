"use client";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";

type SyncAccount = { status: "waiting" | "syncing" | "done" | "error"; error?: string };
type SyncJob = { status: "idle" | "running" | "done"; accounts: SyncAccount[] };

export function SyncButton({ icon }: { icon: ReactNode }) {
  const [status, setStatus] = useState<SyncJob["status"] | "error">("idle");
  const [detail, setDetail] = useState("");
  const [failure, setFailure] = useState("");

  const showJob = (job: SyncJob) => {
    const completed = job.accounts.filter((account) => account.status === "done" || account.status === "error").length;
    const failed = job.accounts.filter((account) => account.status === "error");
    setStatus(job.status);
    setDetail(job.accounts.length ? `${completed}/${job.accounts.length}` : "");
    setFailure(
      failed
        .map((account) => account.error)
        .filter(Boolean)
        .join("; "),
    );
  };

  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    socket.onmessage = (event) => {
      const value = JSON.parse(event.data);
      if (value.type === "sync.status") showJob(value.job);
    };
    void apiJson<SyncJob>("/api/sync", { cache: "no-store" })
      .then(showJob)
      .catch(() => {});
    if (!sessionStorage.getItem("email-agent-start-sync")) {
      sessionStorage.setItem("email-agent-start-sync", "checked");
      void apiJson<any>("/api/settings")
        .then((value) => value.settings?.sync_on_start && sync())
        .catch(() => {});
    }
    return () => socket.close();
  }, []);

  const sync = async () => {
    setStatus("running");
    setDetail("0/0");
    setFailure("");
    try {
      showJob(await apiJson<SyncJob>("/api/sync", { method: "POST" }, "Could not start sync"));
    } catch (error) {
      setStatus("error");
      setFailure(errorMessage(error, "Could not start sync"));
    }
  };

  const failed = Boolean(failure);
  const label =
    status === "running"
      ? `Syncing ${detail}`
      : status === "done"
        ? failed
          ? `Sync failed ${detail}`
          : `Synced ${detail}`
        : status === "error"
          ? "Sync failed"
          : "Sync mail";
  return (
    <Button
      variant={failed ? "danger" : "outline"}
      size="sm"
      onClick={sync}
      disabled={status === "running"}
      title={failure || undefined}
    >
      {icon}
      <span className="sync-label">{label}</span>
    </Button>
  );
}
