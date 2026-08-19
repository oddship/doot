# Architecture

Doot runs as one Node.js process. A custom server prepares Next.js and owns the `/ws` upgrade while Next route handlers own HTTP APIs and the agent SSE stream.

```text
┌──────────────── browser ────────────────┐
│ React workspace · Inbox · History       │
│ Settings · Flows                        │
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
- Active sessions live in a bounded in-memory map; persisted sessions remain replayable after restart but are intentionally not resumable.
- WebSocket events refresh background state. The agent response itself uses the AI SDK UI message SSE protocol.

## Performance choices

SQLite uses WAL, normal synchronous mode, a busy timeout, memory temp tables, and targeted indexes. Hidden workspace tabs stop two-second HTTP polling while detached agent work continues; visibility restoration and WebSocket events refresh the UI. Email frame documents are memoized and resize from contained content.

## Trust boundaries

See the [safety model](../../01-guide/02-safety-model.md). The critical invariant is that analysis tools and mailbox write functions are separate, with persisted proposals and browser confirmation between them.
