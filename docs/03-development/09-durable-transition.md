# Durable transition: plan and operation

Scope: replace the in-memory agent session, not the mailbox mutation engine. Browser-confirmed Flow/proposal/draft/folder endpoints remain the only mailbox-write boundary. Reuse the completed mock recovery tests; do not build another prototype/UI.

1. Add a production Durable session adapter using the existing model/credential runtime and bounded read-only codemode. No shell, filesystem-discovered extensions, or mailbox mutation tools.
2. Persist one Durable conversation per existing Doot conversation ID in private SQLite storage next to the configured cache. Continue existing IDs and retain History; import legacy transcript context once without importing body permissions.
3. Persist exact selected/approved references, run body budgets, query validation and Flow provenance. Reserve body budgets before network reads. All local-effect tools and codemode default to unsafe replay; interrupted calls report interruption rather than repeating effects.
4. Adapt committed Durable events to existing SSE and History. Reject overlapping requests before mutating run context. Restore interrupted context before recovery; never replace permissions with those of a new request while an old run is still live.
5. Keep the existing browser mailbox execution outside Durable. It is not enrolled in restart/replay. Unknown IMAP results continue requiring review, not automatic retries.
6. Validate with faux model turns, restart/context tests, codemode/tool guard regressions, full tests/typecheck/build and existing crash/wire tests. Do not test by fetching real unapproved bodies or mutating real mail.
7. Cut over the app only after validation. Preserve `next-env.d.ts`; take a private cache backup before the live restart and verify no agent run is active. Keep the old cache/History intact for rollback.

## Implemented operation

`lib/agent-durable.ts` replaces `createAgentSession`/in-memory SessionManager with a Durable Harness. It retains the existing ModelRuntime/credential store and reuses the existing bounded QuickJS codemode executor. No built-in coding tools or environment are installed. Tools remain `replay: "unsafe"`, including read-only codemode; a new model call may inspect existing records, but an interrupted tool execution is not repeated automatically.

The configured cache path determines the private `<cache-path>.agent-sessions/` directory (mode 0700). Each existing Doot conversation ID maps to a SHA-256 filename containing a single Durable root conversation (database mode 0600). Back up that directory together with the cache; SQLite WAL/SHM files and all Durable transcripts contain private context and must be protected. Do not run two server processes against these files concurrently.

Legacy History context is imported once as untrusted transcript context. Legacy body approvals are not imported. Existing Flow creation provenance is restored from History and combined with the Durable document. New turns explicitly replace selected references and reset run budgets only after any old run settles. Overlapping browser requests are rejected before they can overwrite run context.

The internal token-protected `/api/agent/recover` tick resumes interrupted Durable agent conversations. Legacy runs with no Durable file are still marked interrupted on startup. The existing SSE shape and History endpoints are unchanged; committed assistant/tool-result entries have idempotent History projection. Cancellation is available through `POST /api/agent/sessions/:id/cancel` with `{ "confirm": true }`. Browser mailbox proposal/Flow/draft/folder execution remains unchanged and is never resumed by Durable.

Validation includes production-adapter faux model turns, same-ID continuation after reopening, History projection deduplication, body-budget reservation restoration, and unsafe-tool interruption without replay, in addition to the previously completed process-crash/mock-IMAP tests. Tests use private databases and synthetic messages only.

For rollback, stop the server, restore the previous code/dependencies and cache backup, and retain (do not overwrite/delete) the Durable directory. The previous runtime cannot resume Durable tasks, but existing cache/Flow/History data remain readable. Do not replay interrupted mailbox proposals to compensate for a runtime rollback.

Durable SQLite and the mail cache are distinct persistence authorities. Mailbox/local proposal effects and Durable tool receipts are not an atomic transaction; unsafe replay is mandatory. A process restart may interrupt such a tool after its local effect, and the model must inspect/reuse existing records instead of repeating it.
