# Local query performance

Inbox searches, dashboard summaries, and agent analysis use `canonical_messages` to deduplicate provider messages across folders. Optimization must preserve the selected account/folder/UID and apply search filters **after** canonical selection. A matching duplicate must not cause a non-matching winner to appear in results.

## Lightweight canonical selection

`lib/database.ts` ranks only account/folder/UID keys, rather than copying every message column (including cached bodies) into the window-function intermediate result. It joins winning keys back to `messages`, letting each consumer request only the columns it needs.

The partitioning and ranking rules are unchanged: provider IDs deduplicate within an account; messages without provider IDs remain folder/UID scoped; Inbox is preferred, then All Mail, then the existing folder and numeric UID ordering. The view still exposes all original message columns and `canonical_rank`. Schema replacement remains atomic.

## Shared aggregates

`lib/message-facets.ts` computes counts, account groups, top senders/domains, and age buckets from one streaming SELECT of `account`, `account_email`, `sender`, and `date_ts`. This replaces eight independent canonical queries with one consistent read snapshot. The agent receives aggregates only; no bodies or full header list are returned.

Sender ties retain SQLite BINARY ordering, including supplementary Unicode characters. Domain parsing/order, age-bucket boundaries, filters, and limits retain their previous behavior. No persistent aggregate cache is introduced, so visibility and header changes are reflected immediately.

Dashboard total counts and cached-body totals are derived from its account-summary query. Empty-cache body totals remain `null`, and the public account response shape is unchanged. The recent-header query remains separate.

## Repeatable cache-copy benchmark

```bash
npm run bench:queries
DOOT_BENCH_DATABASE_PATH=/path/to/cache.sqlite3 npm run bench:queries
```

The benchmark opens its source read-only, makes a private temporary SQLite backup, and applies the current schema to the copy. It compares current queries against frozen pre-optimization definitions, verifies matching winners/header pages/facets, and reports median timings from seven warmed repetitions. The temporary copy is deleted afterward. No IMAP connection, body approval, or mailbox mutation is involved; output contains timings and counts, not private headers or bodies.

A sample with 6,717 canonical messages:

| Operation | Before | After |
| --- | ---: | ---: |
| Canonical count | 23.3 ms | 17.2 ms |
| Header page (25 rows, excluding total count) | 24.8 ms | 20.6 ms |
| Whole-cache facets | 216.5 ms | 41.2 ms |
| LinkedIn-domain facets (43 matches) | 228.0 ms | 21.5 ms |

These are local database/function measurements, not end-to-end UI or model-latency claims. Results depend on cache size, cached-body sizes, hardware, and system load. The opt-in benchmark is skipped in the regular test suite; correctness tests use synthetic private databases.
