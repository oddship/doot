import type { FetchMessageObject, ImapFlow } from "imapflow";

export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
export const MAX_BODY_BATCH_MESSAGES = 5;
// Bound retained raw source bytes, not just the number of messages.
export const MAX_BODY_BATCH_BYTES = MAX_MESSAGE_BYTES;

export function planBodyBatches(messages: Array<{ uid: number; size: number }>) {
  const batches: number[][] = [];
  let batch: number[] = [];
  let bytes = 0;
  for (const message of messages) {
    if (!Number.isSafeInteger(message.uid) || message.uid < 1 || message.uid > 0xffffffff)
      throw new Error("Invalid message UID");
    if (!Number.isSafeInteger(message.size) || message.size < 0 || message.size > MAX_MESSAGE_BYTES)
      throw new Error("message exceeds the 25 MB safe reading limit or has invalid size metadata");
    if (batch.length && (batch.length >= MAX_BODY_BATCH_MESSAGES || bytes + message.size > MAX_BODY_BATCH_BYTES)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(message.uid);
    bytes += message.size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export type BodyFetchMetrics = {
  metadata_fetches: number;
  source_fetches: number;
  source_bytes: number;
  metadata_ms: number;
  source_ms: number;
};

export async function fetchBodyBatches(
  client: Pick<ImapFlow, "fetchAll">,
  uids: number[],
  consume: (messages: FetchMessageObject[]) => Promise<void>,
  metrics: BodyFetchMetrics,
) {
  if (!uids.length) return;
  const expected = new Set(uids);
  const metadataStarted = performance.now();
  metrics.metadata_fetches++;
  const metadata = await client.fetchAll(uids, { uid: true, size: true }, { uid: true });
  metrics.metadata_ms += performance.now() - metadataStarted;
  const byUid = new Map(metadata.map((message) => [message.uid, message]));
  const batches = planBodyBatches(
    uids.map((uid) => {
      const message = byUid.get(uid);
      if (!message) throw new Error("message not found upstream");
      return { uid, size: message.size ?? Number.NaN };
    }),
  );
  for (const batch of batches) {
    const started = performance.now();
    metrics.source_fetches++;
    // ImapFlow maps source:true to BODY.PEEK[]; fetching a batch preserves \Seen.
    const messages = await client.fetchAll(batch, { uid: true, source: true }, { uid: true });
    metrics.source_ms += performance.now() - started;
    const found = new Set<number>();
    let bytes = 0;
    for (const message of messages) {
      if (!expected.has(message.uid) || !batch.includes(message.uid) || found.has(message.uid))
        throw new Error("Unexpected message UID in body fetch");
      found.add(message.uid);
      if (!message.source) throw new Error("message source was not returned upstream");
      if (message.source.byteLength > MAX_MESSAGE_BYTES)
        throw new Error("message exceeds the 25 MB safe reading limit");
      bytes += message.source.byteLength;
      if (bytes > MAX_BODY_BATCH_BYTES) throw new Error("body batch exceeds the safe reading byte budget");
    }
    if (batch.some((uid) => !found.has(uid))) throw new Error("message source was not returned upstream");
    metrics.source_bytes += bytes;
    await consume(messages);
  }
}
