// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  cacheWindowNeedsRefresh,
  checkpointMatches,
  normalizeSyncWindow,
  planFlagRefresh,
  selectSyncFolders,
  uidBatches,
} from "@/lib/imap-sync";

describe("IMAP sync planning", () => {
  it("normalizes unsafe sync windows", () => {
    expect(normalizeSyncWindow(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ days: 30, limit: 75 });
    expect(normalizeSyncWindow(-10, -4)).toEqual({ days: 1, limit: 1 });
    expect(normalizeSyncWindow(30, 0)).toEqual({ days: 30, limit: 0 });
    expect(normalizeSyncWindow(50_000, 50_000)).toEqual({ days: 3650, limit: 10_000 });
  });

  it("only skips work for an exact stable checkpoint", () => {
    const checkpoint = {
      uid_validity: "7",
      uid_next: 101,
      highest_modseq: "9001",
      mailbox_messages: 100,
      sync_days: 30,
      sync_limit: 250,
    };
    const snapshot = { uidValidity: "7", uidNext: 101, highestModseq: "9001", messages: 100 };

    expect(checkpointMatches(checkpoint, snapshot, { days: 30, limit: 250 })).toBe(true);
    expect(checkpointMatches(checkpoint, { ...snapshot, uidNext: 102 }, { days: 30, limit: 250 })).toBe(false);
    expect(checkpointMatches(checkpoint, snapshot, { days: 60, limit: 250 })).toBe(false);
    expect(checkpointMatches(checkpoint, snapshot, { days: 30, limit: 250 }, true)).toBe(false);
    expect(checkpointMatches({ ...checkpoint, highest_modseq: null }, snapshot, { days: 30, limit: 250 })).toBe(false);
  });

  it("refreshes active rows that exceed a finite target or fall outside lookback", () => {
    expect(cacheWindowNeedsRefresh({ active: 101 }, { days: 30, limit: 100 })).toBe(true);
    expect(cacheWindowNeedsRefresh({ active: 100 }, { days: 30, limit: 100 })).toBe(false);
    expect(cacheWindowNeedsRefresh({ active: 20_000 }, { days: 30, limit: 0 })).toBe(false);
    expect(cacheWindowNeedsRefresh({ active: 10, outsideLookback: 1 }, { days: 30, limit: 0 })).toBe(true);
  });

  it("de-duplicates, validates, and bounds UID batches", () => {
    expect(uidBatches([3, 2, 3, 0, -1, 4], 2)).toEqual([[3, 2], [4]]);
    expect(uidBatches([1, 2, 3], 10_000)).toEqual([[1, 2, 3]]);
  });

  it("uses mod-sequence updates when CONDSTORE is available", () => {
    expect(
      planFlagRefresh({
        desiredUids: [3, 4],
        cachedPresentUids: [1, 2, 3],
        supportsCondstore: true,
        previousHighestModseq: "40",
        currentHighestModseq: "42",
      }),
    ).toEqual({ strategy: "condstore", uids: [1, 2, 3], changedSince: "40" });
  });

  it("falls back to refreshing only the bounded desired cache window", () => {
    expect(
      planFlagRefresh({
        desiredUids: [2, 3, 4],
        cachedPresentUids: [1, 2, 3],
        supportsCondstore: false,
      }),
    ).toEqual({ strategy: "bounded", uids: [2, 3], changedSince: null });
  });

  it("uses Gmail All Mail once for the recommended scope", () => {
    const folders = [
      { path: "INBOX", special_use: "\\Inbox" },
      { path: "[Gmail]/All Mail", special_use: "\\All" },
      { path: "Receipts" },
    ];
    expect(selectSyncFolders(folders, "gmail", "recommended").map((folder) => folder.path)).toEqual([
      "[Gmail]/All Mail",
    ]);
  });

  it("selects useful standard IMAP folders without noselect containers", () => {
    const folders = [
      { path: "INBOX", special_use: "\\Inbox" },
      { path: "Archive", special_use: "\\Archive" },
      { path: "Sent", special_use: "\\Sent" },
      { path: "Parent", flags: ["\\Noselect"] },
    ];
    expect(selectSyncFolders(folders, "imap", "recommended").map((folder) => folder.path)).toEqual([
      "INBOX",
      "Archive",
      "Sent",
    ]);
  });

  it("validates custom selections and falls back to Inbox when empty", () => {
    const folders = [{ path: "INBOX" }, { path: "Receipts" }, { path: "Parent", flags: ["\\Noselect"] }];
    expect(selectSyncFolders(folders, "imap", "custom", ["Receipts", "Parent", "Missing"])).toEqual([
      { path: "Receipts" },
    ]);
    expect(selectSyncFolders(folders, "imap", "custom", ["Missing"])).toEqual([{ path: "INBOX" }]);
  });
});
