"use client";

import { CalendarClock, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog, useToast } from "@/components/feedback";
import { LocalTime } from "@/components/local-time";
import { Badge, Button, Card, Dialog, Label } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";

type Schedule = {
  id: number;
  kind: "flow" | "sync";
  rule_id: number | null;
  rule_name?: string;
  frequency: "once" | "daily" | "weekly";
  timezone: string;
  next_run_at: string;
  last_run_at?: string | null;
  enabled: boolean;
};

function localInput(date = new Date(Date.now() + 3_600_000)) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ScheduleControls({ kind, ruleId }: { kind: "flow" | "sync"; ruleId?: number }) {
  const toast = useToast();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [editor, setEditor] = useState<{ frequency: Schedule["frequency"]; next: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const query = `/api/schedules?kind=${kind}${ruleId ? `&rule_id=${ruleId}` : ""}`;
  const load = async () => {
    try {
      setSchedules((await apiJson<{ schedules: Schedule[] }>(query)).schedules);
    } catch (error) {
      toast.error("Could not load schedules", errorMessage(error));
    }
  };
  useEffect(() => {
    void load();
  }, [kind, ruleId]);
  const create = async () => {
    if (!editor) return;
    setBusy(true);
    try {
      await apiJson("/api/schedules", {
        method: "POST",
        json: {
          confirm: true,
          kind,
          rule_id: ruleId,
          frequency: editor.frequency,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          next_run_at: new Date(editor.next).toISOString(),
          enabled: true,
        },
      });
      setEditor(null);
      await load();
      toast.success(
        "Schedule created",
        kind === "flow" ? "Runs prepare proposals for review." : "Sync will run automatically.",
      );
    } catch (error) {
      toast.error("Could not create schedule", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (schedule: Schedule) => {
    setBusy(true);
    try {
      await apiJson(`/api/schedules/${schedule.id}`, {
        method: "PUT",
        json: {
          confirm: true,
          enabled: !schedule.enabled,
          ...(schedule.enabled ? {} : { next_run_at: new Date(Date.now() + 3_600_000).toISOString() }),
        },
      });
      await load();
      toast.success(schedule.enabled ? "Schedule paused" : "Schedule resumed");
    } catch (error) {
      toast.error("Could not update schedule", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await apiJson(`/api/schedules/${pendingDelete.id}`, { method: "DELETE", json: { confirm: true } });
      setPendingDelete(null);
      await load();
      toast.success("Schedule deleted");
    } catch (error) {
      toast.error("Could not delete schedule", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="schedule-card">
      <div className="node-title-row">
        <div>
          <h2>
            <CalendarClock size={17} /> {kind === "flow" ? "Flow schedule" : "Sync schedules"}
          </h2>
          <p className="muted">
            {kind === "flow"
              ? "Scheduled evaluations prepare reviewable proposals. They never change mail automatically."
              : "Scheduled sync is read-only, preserves unread state, and records every job in History."}
          </p>
        </div>
        <Button
          tooltip="Choose a recurring run time"
          onClick={() => setEditor({ frequency: "daily", next: localInput() })}
        >
          <Plus size={14} /> Add schedule
        </Button>
      </div>
      {schedules.length ? (
        <div className="schedule-list">
          {schedules.map((schedule) => (
            <div className="schedule-row" key={schedule.id}>
              <div>
                <strong>{schedule.frequency[0].toUpperCase() + schedule.frequency.slice(1)}</strong>
                <span>
                  {schedule.enabled
                    ? "Next "
                    : schedule.frequency === "once" && schedule.last_run_at
                      ? "Completed · ran "
                      : "Paused · was due "}
                  <LocalTime value={schedule.next_run_at} /> · {schedule.timezone}
                </span>
              </div>
              <Badge tone={schedule.enabled ? "good" : "neutral"}>
                {schedule.enabled
                  ? "Enabled"
                  : schedule.frequency === "once" && schedule.last_run_at
                    ? "Completed"
                    : "Paused"}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                tooltip={schedule.enabled ? "Stop future scheduled evaluations" : "Resume in one hour"}
                disabled={busy}
                onClick={() => void toggle(schedule)}
              >
                {schedule.enabled ? <Pause size={13} /> : <Play size={13} />}
                {schedule.enabled ? "Pause" : "Resume"}
              </Button>
              <Button
                variant="danger"
                size="icon"
                aria-label="Delete schedule"
                tooltip="Remove this recurring schedule"
                disabled={busy}
                onClick={() => setPendingDelete(schedule)}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted schedule-empty">No schedule configured.</p>
      )}
      <Dialog
        open={Boolean(editor)}
        title={`Schedule ${kind === "flow" ? "Flow evaluation" : "mail sync"}`}
        onClose={() => setEditor(null)}
      >
        {editor && (
          <div className="form-grid">
            <div>
              <Label>Repeat</Label>
              <select
                value={editor.frequency}
                onChange={(event) => setEditor({ ...editor, frequency: event.target.value as Schedule["frequency"] })}
              >
                <option value="once">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div>
              <Label>First run</Label>
              <input
                className="input"
                type="datetime-local"
                min={localInput(new Date())}
                value={editor.next}
                onChange={(event) => setEditor({ ...editor, next: event.target.value })}
              />
            </div>
            <p className="muted field-wide">
              Times use {Intl.DateTimeFormat().resolvedOptions().timeZone || "your browser timezone"}. Creating this
              schedule is explicit authorization for future evaluations. Flow evaluations still stop at proposal review.
            </p>
            <div className="field-wide memory-dialog-actions">
              <Button variant="outline" tooltip="Discard this schedule" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button
                tooltip="Enable this recurring schedule"
                disabled={busy || !editor.next}
                onClick={() => void create()}
              >
                {busy ? "Creating…" : "Create schedule"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete schedule?"
        description={<p>Future runs will stop. Existing History records and proposals remain available.</p>}
        confirmLabel="Delete schedule"
        dangerous
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setPendingDelete(null)}
      />
    </Card>
  );
}
