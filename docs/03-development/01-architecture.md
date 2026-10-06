# Architecture

Doot runs as one Node.js process. A custom server prepares Next.js and owns the `/ws` upgrade while Next route handlers own HTTP APIs and the agent SSE stream.

The HTTP catch-all is a thin adapter over typed domain handlers in `lib/api/`. Accounts, provider/Agent state, drafts, schedules, Flows, mailbox/proposals, workspaces, and system endpoints are isolated modules sharing one confirmation parser and error boundary.

```text
┌──────────────── browser ────────────────┐
│ React workspace · Inbox · Drafts        │
│ History · Settings · Flows              │
└───────┬─────────────────┬───────────────┘
        │ HTTP/SSE        │ WebSocket status
┌───────▼─────────────────▼───────────────┐
│ custom Node server + Next.js            │
│ Pi runtime · validated tools · ImapFlow │
└──────────────┬───────────────┬──────────┘
               │               │
         SQLite + FTS5       IMAP servers
```

## Data paths

- Sync jobs connect to accounts concurrently, publish independent progress, and persist header snapshots.
- Inbox queries use indexed account/date paths and FTS5 for free text. Bodies are fetched lazily.
- Agent runs persist every user, assistant, reasoning, tool, status, error, proposal, artifact, and workspace event.
- Agent conversations, sync jobs, Flow runs, schedules, and mailbox actions share the versioned `agent_sessions` / `agent_events` History ledger.
- Settings discovers provider authentication capabilities from Pi. The app only transports Pi's generic login prompts and events; Pi owns provider-specific URLs, token exchange, refresh, and logout, while an app-owned SQLite `CredentialStore` provides persistence.
- The custom server checks persisted schedules every 30 seconds. Sync schedules start read-only jobs; active Flow schedules evaluate the current cache and create a bounded proposal for browser review.
- Active handles live in a bounded process-wide map, while Pi Durable persists transcripts, task receipts, exact approvals, and run budgets in private per-conversation SQLite files. Existing Doot conversation IDs select a stable hashed file beneath `<cache-path>.agent-sessions/`. Interrupted agent runs are recovered through the internal startup/scheduler tick; tools are unsafe to replay. Mailbox writes remain separate browser-confirmed operations.
- Durable committed entries are projected into the existing History ledger with unique `(session_id, durable_key)` receipts, so reconnect/recovery backfills do not duplicate assistant messages or tool results. The two databases are not an atomic transaction; local-effect tools must never use safe replay.
- WebSocket events refresh background state. The agent response itself uses an AI SDK-compatible UI message SSE protocol implemented by `lib/ui-message-stream.ts` so detached runs can outlive a browser reader.

Schedules are local process timers, not an external task service. A missed persisted schedule is picked up when Doot next starts. Daily and weekly recurrence advances from the previously scheduled instant to avoid runtime drift; the recorded IANA timezone is retained for display. No scheduled path invokes a model or applies an IMAP mutation.

## Performance choices

SQLite uses WAL, normal synchronous mode, a busy timeout, memory temp tables, and targeted indexes. Messages and sync checkpoints use folder-scoped IMAP identity: `(account, folder, UID)`. The sync scope is user-configurable: Inbox only; a provider-recommended scope that uses Gmail All Mail once or standard IMAP Inbox, Archive, and Sent; or exact custom folders discovered from the server. Unselected folder rows become inactive without discarding cached bodies.

IMAP sync discovers candidate UIDs first, then fetches headers and flag changes in bounded UID batches. Each completed header batch is committed immediately, so a transient disconnect can retry with a fresh connection without discarding completed work. UIDVALIDITY protects cached UID identity; UIDNEXT, message count, sync-window settings, and the server's highest modification sequence form a durable per-folder checkpoint. On CONDSTORE servers, unchanged checkpoints skip message fetches and changed checkpoints request only flag/label changes since the prior modification sequence. Servers without CONDSTORE use the same bounded cache window without assuming unsupported incremental state. Gmail or OBJECTID provider IDs let Doot reuse a lazily cached body when the same message appears through another synchronized folder.

Hidden workspace tabs stop two-second HTTP polling while detached agent work continues; visibility restoration and WebSocket events refresh the UI. Email frame documents are memoized and resize from contained content.

## Trust boundaries

See the [safety model](../../01-guide/02-safety-model.md). The critical invariant is that analysis tools and mailbox write functions are separate, with persisted proposals and browser confirmation between them.
