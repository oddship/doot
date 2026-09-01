export type SyncWindow = { days: number; limit: number };
export type SyncScope = "inbox" | "recommended" | "custom";

export type SyncFolder = {
  path: string;
  special_use?: string | null;
  flags?: Iterable<string>;
};

export type SyncCheckpoint = {
  uid_validity?: string | null;
  uid_next?: number | null;
  highest_modseq?: string | null;
  mailbox_messages?: number | null;
  sync_days?: number | null;
  sync_limit?: number | null;
};

export type MailboxSnapshot = {
  uidValidity: string;
  uidNext: number;
  highestModseq: string | null;
  messages: number;
};

export function cacheWindowNeedsRefresh(
  stats: { active: number; outsideLookback?: number | null },
  window: SyncWindow,
) {
  return Number(stats.outsideLookback || 0) > 0 || (window.limit > 0 && Number(stats.active) > window.limit);
}

export function normalizeSyncWindow(days: number, limit: number): SyncWindow {
  return {
    days: Math.max(1, Math.min(Number.isFinite(days) ? Math.floor(days) : 30, 3650)),
    limit: limit === 0 ? 0 : Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 75, 10_000)),
  };
}

export function selectSyncFolders(
  folders: SyncFolder[],
  provider: "gmail" | "imap",
  scope: SyncScope,
  customPaths: string[] = [],
) {
  const selectable = folders.filter(
    (folder) => ![...(folder.flags || [])].some((flag) => flag.toLowerCase() === "\\noselect"),
  );
  const inbox = selectable.find((folder) => folder.path.toLowerCase() === "inbox");
  const unique = (values: Array<SyncFolder | undefined>) => [
    ...new Map(
      values.filter((value): value is SyncFolder => Boolean(value)).map((value) => [value.path, value]),
    ).values(),
  ];
  if (scope === "custom") {
    const requested = new Set(customPaths);
    const chosen = selectable.filter((folder) => requested.has(folder.path));
    return chosen.length ? chosen : unique([inbox]);
  }
  if (scope === "recommended" && provider === "gmail") {
    const allMail = selectable.find(
      (folder) => folder.special_use === "\\All" || /(?:^|\])all mail$/i.test(folder.path),
    );
    return unique([allMail, inbox]).slice(0, 1);
  }
  if (scope === "recommended") {
    const archive = selectable.find((folder) => folder.special_use === "\\Archive");
    const sent = selectable.find((folder) => folder.special_use === "\\Sent");
    return unique([inbox, archive, sent]);
  }
  return unique([inbox]);
}

export function checkpointMatches(
  checkpoint: SyncCheckpoint | undefined,
  snapshot: MailboxSnapshot,
  window: SyncWindow,
  forceRefresh = false,
) {
  if (forceRefresh || !checkpoint?.highest_modseq || !snapshot.highestModseq) return false;
  return (
    checkpoint.uid_validity === snapshot.uidValidity &&
    Number(checkpoint.uid_next) === snapshot.uidNext &&
    checkpoint.highest_modseq === snapshot.highestModseq &&
    Number(checkpoint.mailbox_messages) === snapshot.messages &&
    Number(checkpoint.sync_days) === window.days &&
    Number(checkpoint.sync_limit) === window.limit
  );
}

export function uidBatches(values: Iterable<number>, batchSize = 250) {
  const size = Math.max(1, Math.min(Math.floor(batchSize) || 250, 1000));
  const uids = [...new Set([...values].filter((uid) => Number.isSafeInteger(uid) && uid > 0))];
  const batches: number[][] = [];
  for (let index = 0; index < uids.length; index += size) batches.push(uids.slice(index, index + size));
  return batches;
}

export function planFlagRefresh(input: {
  desiredUids: number[];
  cachedPresentUids: number[];
  supportsCondstore: boolean;
  previousHighestModseq?: string | null;
  currentHighestModseq?: string | null;
  forceRefresh?: boolean;
}) {
  const cached = new Set(input.cachedPresentUids);
  const incremental = Boolean(
    !input.forceRefresh && input.supportsCondstore && input.previousHighestModseq && input.currentHighestModseq,
  );
  return {
    strategy: incremental ? ("condstore" as const) : ("bounded" as const),
    uids: incremental ? [...cached] : input.desiredUids.filter((uid) => cached.has(uid)),
    changedSince: incremental ? input.previousHighestModseq || null : null,
  };
}
