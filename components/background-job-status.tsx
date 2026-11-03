"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "@/lib/client-api";
import { createRefreshQueue } from "@/lib/client-refresh";
import { useCacheEvents } from "@/lib/use-cache-events";

type Job = {
  id: string;
  kind: string;
  status: string;
  completed: number;
  total: number;
  history_id: string;
  error?: string;
};
export function BackgroundJobStatus() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const load = useMemo(
    () =>
      createRefreshQueue(() =>
        apiJson<{ jobs: Job[] }>("/api/jobs", { cache: "no-store" })
          .then((value) => setJobs(value.jobs))
          .catch(() => {}),
      ),
    [],
  );
  useCacheEvents((event) => {
    if (event.type === "cache.refresh" && ["all", "jobs"].includes(event.resource)) void load();
  });
  useEffect(() => {
    void load();
  }, []);
  const active = jobs.filter((job) => ["queued", "running", "needs_review"].includes(job.status));
  if (!active.length) return null;
  return (
    <aside className="background-job-status" aria-live="polite">
      {active.map((job) => (
        <Link
          key={job.id}
          href={`/history/${job.history_id}`}
          title={job.error || "Work is stored in the app; you can close this browser"}
        >
          {job.kind} ·{" "}
          {job.status === "needs_review" ? "Needs review" : `${job.completed}/${job.total} · ${job.status}`}
        </Link>
      ))}
    </aside>
  );
}
