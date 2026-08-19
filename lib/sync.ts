import { randomUUID } from "node:crypto";
import { emitBackground, store } from "@/lib/store";

export type SyncJob = {
  id: string | null;
  status: "idle" | "running" | "done";
  started_at: string | null;
  finished_at: string | null;
  accounts: any[];
  results: any[];
};
let job: SyncJob = { id: null, status: "idle", started_at: null, finished_at: null, accounts: [], results: [] };

export function getSyncJob() {
  return job;
}

export async function startSync() {
  if (job.status === "running") return job;
  const [{ accounts }, { settings }] = await Promise.all([store<any>(["accounts"]), store<any>(["settings-get"])]);
  const id = `sync-${randomUUID()}`;
  job = {
    id,
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    accounts: accounts.map((account: any) => ({ name: account.name, email: account.email, status: "waiting" })),
    results: [],
  };
  await store([
    "session-start",
    JSON.stringify({ id, kind: "job", title: `Sync mail · ${accounts.length} accounts`, status: "running" }),
  ]);
  await store([
    "session-event",
    JSON.stringify({
      session_id: id,
      event_type: "job_started",
      content: `Syncing ${accounts.length} connected accounts`,
      metadata: { sync_days: settings.sync_days, per_account_limit: settings.initial_sync_limit },
    }),
  ]);
  emitBackground({ type: "sync.status", job });
  void Promise.all(
    accounts.map(async (account: any) => {
      const target = job.accounts.find((item) => item.name === account.name);
      target.status = "syncing";
      await store([
        "session-event",
        JSON.stringify({
          session_id: id,
          event_type: "sync_account_started",
          content: account.email,
          metadata: { account: account.name, email: account.email },
        }),
      ]);
      emitBackground({ type: "sync.status", account: target, job });
      try {
        const result = await store<any>([
          "sync",
          "--account",
          account.name,
          "--days",
          String(settings.sync_days),
          "--limit",
          String(settings.initial_sync_limit),
        ]);
        target.status = result.errors?.length ? "error" : "done";
        if (result.errors?.length) target.error = result.errors.map((item: any) => item.error).join("; ");
        target.result = result;
        job.results.push(result);
        const summary = result.accounts?.[0];
        await store([
          "session-event",
          JSON.stringify({
            session_id: id,
            event_type: target.status === "done" ? "sync_account_complete" : "sync_account_error",
            content:
              target.status === "done"
                ? `${account.email}: ${summary?.cached || 0} cached (${summary?.new || 0} new, ${summary?.backfilled || 0} backfilled)`
                : `${account.email}: ${target.error}`,
            metadata: { account: account.name, email: account.email, status: target.status, result },
          }),
        ]);
      } catch (error: any) {
        target.status = "error";
        target.error = String(error?.message || error);
        await store([
          "session-event",
          JSON.stringify({
            session_id: id,
            event_type: "sync_account_error",
            content: `${account.email}: ${target.error}`,
            metadata: { account: account.name, email: account.email, status: "error" },
          }),
        ]);
      }
      emitBackground({ type: "sync.status", account: target, job });
    }),
  ).finally(async () => {
    job.status = "done";
    job.finished_at = new Date().toISOString();
    const failed = job.accounts.filter((account) => account.status === "error");
    await store([
      "session-event",
      JSON.stringify({
        session_id: id,
        event_type: "job_complete",
        content: failed.length
          ? `Sync finished with ${failed.length} failed account(s)`
          : `Sync completed for ${job.accounts.length} accounts`,
        status: failed.length ? "error" : "complete",
        error: failed.length ? failed.map((account) => `${account.email}: ${account.error}`).join("; ") : undefined,
        metadata: { accounts: job.accounts, results: job.results },
      }),
    ]);
    emitBackground({ type: "sync.status", job });
    emitBackground({ type: "cache.refresh", resource: "messages" });
  });
  return job;
}
