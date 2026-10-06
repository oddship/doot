// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, it } from "vitest";
import { openMockMailboxWorkflow, type Plan } from "../experiments/durable-mailbox";
import { mockImapWire } from "./helpers/mock-imap-wire";

const plan: Plan = {
  messages: [{ account: "fake", folder: "INBOX", uid: "1", uidValidity: "42" }],
  actions: ["mark_read", "move"],
  destination: "transactions",
};
it.each(["success", "rejected-removal", "lost-label-ack", "changed-validity"] as const)(
  "Durable handles mock IMAP over loopback TCP: %s",
  async (mode) => {
    const directory = mkdtempSync(path.join(tmpdir(), "doot-wire-workflow-"));
    const wire = await mockImapWire();
    const database = path.join(directory, "durable.sqlite");
    const open = () =>
      openNodeSqliteStorage(database).then((storage) => openMockMailboxWorkflow(storage, wire.transport()));
    let workflow = await open();
    try {
      if (mode === "rejected-removal") wire.rejectRemoval();
      if (mode === "lost-label-ack") wire.disconnectAfterLabel();
      const id = await workflow.create(plan);
      const review = await workflow.get(id);
      if (mode === "changed-validity") wire.changeValidity("43");
      await workflow.approve(id, review.fingerprint, true);
      const result = await workflow.wait(id);
      expect(result.status, `${result.error}; ${JSON.stringify(wire.commands)}`).toBe(
        mode === "success" ? "applied" : mode === "lost-label-ack" ? "needs_reconciliation" : "failed",
      );
      expect(result.receipts).toHaveLength(
        mode === "success" ? 3 : mode === "rejected-removal" ? 2 : mode === "lost-label-ack" ? 1 : 0,
      );
      if (mode === "changed-validity") expect(result.error).toContain("UIDVALIDITY changed");
      expect(wire.seen).toBe(mode !== "changed-validity");
      expect(wire.labels).toEqual(
        new Set(
          mode === "success" ? ["transactions"] : mode === "changed-validity" ? ["INBOX"] : ["INBOX", "transactions"],
        ),
      );
      const writes = wire.commands.filter((command) => command.includes("UID STORE"));
      expect(writes).toHaveLength(mode === "changed-validity" ? 0 : mode === "lost-label-ack" ? 2 : 3);
      await workflow.close();
      workflow = await open();
      expect((await workflow.wait(id)).status).toBe(result.status);
      expect(wire.commands.filter((command) => command.includes("UID STORE"))).toEqual(writes);
    } finally {
      await workflow.close();
      await wire.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15000,
);
