"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog, useToast } from "@/components/feedback";
import { Badge, Button } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";
import { type MailAction, mailActionLabel } from "@/lib/mail-actions";

type Proposal = {
  id: number;
  action: MailAction;
  actions?: MailAction[];
  status: string;
  items: Array<{ account: string; uid: string; source_folder?: string; folder?: string }>;
  reason?: string;
};

export function HistoryProposalAction({ proposal }: { proposal: Proposal }) {
  const toast = useToast();
  const label = mailActionLabel({ ...proposal, target_folder: proposal.items.find((item) => item.folder)?.folder });
  const [status, setStatus] = useState(proposal.status);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasExactSources = proposal.items.every((item) => Boolean(item.source_folder));
  const apply = async () => {
    setBusy(true);
    try {
      const result = await apiJson<{ status: string }>("/api/apply", {
        method: "POST",
        json: { id: proposal.id, confirm: true },
      });
      setStatus(result.status);
      setConfirming(false);
      if (result.status === "applied")
        toast.success("Proposal applied", `${proposal.items.length} mailbox item(s) processed.`);
      else toast.error("Proposal partly applied", "Some steps may have completed. Review History before retrying.");
    } catch (error) {
      toast.error("Could not apply proposal", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="history-proposal-action">
      <div>
        <span>Review item</span>
        <strong>
          {label} · {proposal.items.length} message{proposal.items.length === 1 ? "" : "s"}
        </strong>
        {proposal.reason && <small>{proposal.reason}</small>}
      </div>
      {status === "proposed" ? (
        hasExactSources ? (
          <Button tooltip="Review and approve mailbox changes" onClick={() => setConfirming(true)}>
            <ShieldCheck size={14} /> Review &amp; apply
          </Button>
        ) : (
          <Badge tone="error">Recreate proposal · source folder missing</Badge>
        )
      ) : (
        <Badge tone={status === "applied" ? "good" : "error"}>
          <CheckCircle2 size={12} /> {status}
        </Badge>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Apply ${label} proposal?`}
        description={
          <>
            <p>
              This will apply {label} to {proposal.items.length} message
              {proposal.items.length === 1 ? "" : "s"} through IMAP. This is the mailbox-write boundary.
            </p>
            {(proposal.actions?.length || 0) > 1 && (
              <p>
                Steps run in order, not atomically. Read status may change even if relocation fails. Review History
                before retrying.
              </p>
            )}
          </>
        }
        confirmLabel={`Approve ${label}`}
        dangerous={proposal.action === "delete"}
        busy={busy}
        onConfirm={() => void apply()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
