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
- Active sessions live in a bounded in-memory map; persisted sessions remain replayable after restart but are intentionally not resumable.
- WebSocket events refresh background state. The agent response itself uses the AI SDK UI message SSE protocol.

Schedules are local process timers, not an external task service. A missed persisted schedule is picked up when Doot next starts. Daily and weekly recurrence advances from the previously scheduled instant to avoid runtime drift; the recorded IANA timezone is retained for display. No scheduled path invokes a model or applies an IMAP mutation.

## Performance choices

SQLite uses WAL, normal synchronous mode, a busy timeout, memory temp tables, and targeted indexes. Hidden workspace tabs stop two-second HTTP polling while detached agent work continues; visibility restoration and WebSocket events refresh the UI. Email frame documents are memoized and resize from contained content.

## Trust boundaries

See the [safety model](../../01-guide/02-safety-model.md). The critical invariant is that analysis tools and mailbox write functions are separate, with persisted proposals and browser confirmation between them.
