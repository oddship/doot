// Synthetic command-latency benchmark. No credentials, mailbox, or database.
import { setTimeout as sleep } from "node:timers/promises";
import { fetchBodyBatches } from "../lib/imap-body-read.ts";

const latency = Number(process.env.BENCH_IMAP_RTT_MS || 20);
if (!Number.isFinite(latency) || latency < 0 || latency > 1000) throw new Error("BENCH_IMAP_RTT_MS must be 0–1000");
console.log(`Synthetic IMAP benchmark (${latency} ms per FETCH; not a live-mailbox speed measurement)`);
for (const count of [5, 25]) {
  const uids = Array.from({ length: count }, (_, index) => index + 1);
  let commands = 0;
  const client = {
    async fetchAll(ids, query) {
      commands++;
      await sleep(latency);
      return ids.map((uid) => (query.size ? { uid, size: 128 } : { uid, source: Buffer.alloc(128) }));
    },
  };
  const before = performance.now();
  for (const uid of uids) {
    await client.fetchAll([uid], { size: true });
    await client.fetchAll([uid], { source: true });
  }
  const baselineMs = performance.now() - before;
  const baselineCommands = commands;
  commands = 0;
  const metrics = { metadata_fetches: 0, source_fetches: 0, source_bytes: 0, metadata_ms: 0, source_ms: 0 };
  const after = performance.now();
  await fetchBodyBatches(client, uids, async () => {}, metrics);
  console.log(
    JSON.stringify({
      messages: count,
      baseline_fetch_commands: baselineCommands,
      batched_fetch_commands: commands,
      baseline_ms: Math.round(baselineMs),
      batched_ms: Math.round(performance.now() - after),
    }),
  );
}
