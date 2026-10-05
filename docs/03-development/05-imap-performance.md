# IMAP body-read performance

Body review uses a cache-first bulk path in `lib/imap.ts` and bounded network batches in `lib/imap-body-read.ts`. Single-message Inbox reads use the same path.

## What is optimized

- Fully cached bodies require no IMAP connection or mailbox selection.
- Cache misses are grouped by exact account and folder, with up to four groups processed concurrently per request. Requests accept at most 50 references; agent calls remain limited to five approved bodies.
- One UID/size FETCH preflights a group. Source FETCHes use at most five messages and 25 MiB of advertised source bytes per batch. Five ordinary cache misses in one folder therefore take two FETCH commands instead of ten.
- Per-message in-flight promises coalesce overlapping simultaneous callers. Duplicate references do not duplicate network work; results retain the caller's order.
- MIME parsing and cache writes operate on bounded source batches, with one SQLite transaction per batch.
- Existing read-only reusable connections remain in use. No write connection, flags update, or mailbox mutation is introduced.

## Safety retained

Browser selection/approval is checked by the agent tool **before** it invokes the bulk store operation. Every reference is folder-scoped and must exist as a present cache row before network work begins. Reads use `BODY.PEEK[]` via ImapFlow's `source:true`, keeping upstream unread state unchanged.

Size preflight still precedes source downloads. Unexpected/missing UIDs, oversized sources, and oversized batches are rejected. Where a sync UIDVALIDITY checkpoint exists, a changed mailbox UIDVALIDITY requires sync before uncached body reads. Cache writes cannot resurrect rows hidden during a concurrent mailbox action. Failed in-flight work is removed so a later request can reconnect and retry.

## Measuring real runs

Single-message responses include `read_metrics`. Approved agent reads return `metrics` and record a `body_read_metrics` event in History. Metrics contain counts and timings only, never credentials or body content:

- `cache_hits`, `coalesced`, `network_messages`
- `metadata_fetches`, `source_fetches`, `source_bytes`
- `queue_ms`, `connect_ms`, `mailbox_ms`
- `metadata_ms`, `source_ms`, `parse_ms`, `cache_ms`, `total_ms`

Stage timings are summed across account/folder groups; concurrent groups can make their sum exceed `total_ms`, which is wall-clock duration. Coalesced callers report their own wait/total duration, not another request's network work. Warm cached reads and cold uncached reads must be compared separately.

## Repeatable synthetic benchmark

```bash
npm run bench:imap-reads
BENCH_IMAP_RTT_MS=100 npm run bench:imap-reads
```

This simulates latency per FETCH without accessing any mailbox or database. It demonstrates command-count reduction; it does not measure provider latency, TLS/authentication, bandwidth, MIME parsing, model latency, or a real inbox speedup. Use actual approved-run metrics to decide the next optimization.
