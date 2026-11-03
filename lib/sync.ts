import { randomUUID } from "node:crypto";
import { enqueueBackgroundJob, kickBackgroundJobs } from "@/lib/background-jobs";
import { configuredAccounts, db, json, settingsValue } from "@/lib/database";

type SyncJob = {
  id: string | null;
  status: "idle" | "running" | "done";
  started_at: string | null;
  finished_at: string | null;
  accounts: any[];
  results: any[];
};
export function getSyncJob(): SyncJob {
  const row = db
    .prepare("SELECT * FROM background_jobs WHERE kind='sync' ORDER BY created_at DESC,rowid DESC LIMIT 1")
    .get() as any;
  if (!row) return { id: null, status: "idle", started_at: null, finished_at: null, accounts: [], results: [] };
  const steps = db.prepare("SELECT * FROM background_steps WHERE job_id=? ORDER BY position").all(row.id) as any[];
  const running = ["queued", "running"].includes(row.status);
  return {
    id: row.id,
    status: running ? "running" : "done",
    started_at: row.created_at,
    finished_at: running ? null : row.updated_at,
    accounts: steps.map((step) => {
      const input = json<any>(step.input_json, {});
      const result = json<any>(step.result_json, {}) || {};
      const error = step.error || result.errors?.map((item: any) => item.error).join("; ");
      return {
        name: input.account.name,
        email: input.account.email,
        status:
          step.status === "complete" ? (error ? "error" : "done") : step.status === "running" ? "syncing" : "waiting",
        ...(error ? { error } : {}),
        result,
      };
    }),
    results: steps.filter((step) => step.status === "complete").map((step) => json(step.result_json, {})),
  };
}
export function startSync(
  input: { trigger?: "manual" | "schedule" | "startup"; scheduleId?: number; commandId?: string } = {},
) {
  db.transaction(() => {
    const active = db
      .prepare("SELECT id FROM background_jobs WHERE kind='sync' AND status IN ('queued','running') LIMIT 1")
      .get();
    if (active) return;
    const settings = settingsValue();
    const accounts = configuredAccounts().map((account) => ({ name: account.name, email: account.username }));
    enqueueBackgroundJob(
      "sync",
      input.commandId || `sync:${randomUUID()}`,
      { trigger: input.trigger || "manual", schedule_id: input.scheduleId },
      accounts.map((account) => ({ account, settings })),
      `${input.trigger === "schedule" ? "Scheduled sync" : "Sync mail"} · ${accounts.length} accounts`,
    );
  }).immediate();
  kickBackgroundJobs();
  return getSyncJob();
}
export async function startConfiguredSync() {
  const instance = process.env.DOOT_INSTANCE_ID;
  if (!instance) return;
  const key = `sync-startup`;
  db.transaction(() => {
    const old = db.prepare("SELECT value_json FROM app_state WHERE key=?").get(key) as any;
    if (json(old?.value_json, "") === instance) return;
    if (settingsValue().sync_on_start) startSync({ trigger: "startup", commandId: `sync:startup:${instance}` });
    db.prepare(
      "INSERT INTO app_state(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
    ).run(key, JSON.stringify(instance));
  }).immediate();
}
