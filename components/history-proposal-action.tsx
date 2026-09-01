"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog, useToast } from "@/components/feedback";
import { Badge, Button } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";

type Proposal = {
  id: number;
  action: "archive" | "move" | "delete";
  status: string;
  items: Array<{ account: string; uid: string; source_folder?: string; folder?: string }>;
  reason?: string;
};

export function HistoryProposalAction({ proposal }: { proposal: Proposal }) {
  const toast = useToast();
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
      toast.success("Proposal applied", `${proposal.items.length} mailbox item(s) processed.`);
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
          {proposal.action} · {proposal.items.length} message{proposal.items.length === 1 ? "" : "s"}
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
        title={`Apply ${proposal.action} proposal?`}
        description={
          <p>
            This will apply the reviewed action to {proposal.items.length} message
            {proposal.items.length === 1 ? "" : "s"} through IMAP. This is the mailbox-write boundary.
          </p>
        }
        confirmLabel={`Approve ${proposal.action}`}
        dangerous={proposal.action === "delete"}
        busy={busy}
        onConfirm={() => void apply()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
