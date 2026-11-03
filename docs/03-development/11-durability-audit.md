# Browser-independent execution audit

Audit date: 2026-10-07. Baseline: `c3d6e82`.

The app owns work, approvals, progress, and outcomes in SQLite. A browser submits commands and renders saved state. Closing a tab must not cancel accepted work. A restart resumes safe work and exposes uncertain mailbox writes for review without replaying them. Dialog visibility is presentation state, never an execution requirement.

## Inventory and implementation order

| # | Site and code | Finding | Required change | Status |
|---|---|---|---|---|
| 1 | Flows approve/run (`rules-client`, `api/flow-routes`); Inbox apply (`inbox-client`, `api/mail-routes`); History apply (`history-proposal-action`); store apply | Network writes awaited inside HTTP requests. Approval is not claimed atomically; two submissions can execute the same proposal. Outcomes persisted only after the entire batch. Dialogs say to keep them open. | Persist approval and immutable plan atomically, return accepted job ID, execute from app worker. Persist per-message/action claims and receipts, recover queued work, stop uncertain writes without replay. All three UIs observe jobs/History. | Complete |
| 2 | IMAP draft upload (`drafts-client`, `api/draft-routes`, `drafts`) | APPEND depends on request completion; duplicate confirmation can create duplicate drafts. | Queue approved content snapshot, persist claim and upload receipt, block duplicate active upload, keep uncertain append for review. | Complete |
| 3 | Folder/label create, rename, delete (`folder-manager`, `api/account-routes`, `imap`) | External mutation and local cache/rule reconciliation run in a request, without persisted execution claim. | Queue confirmed immutable operation; persist outcome and History, prevent duplicate execution and unsafe restart replay. | Complete |
| 4 | Sync (`sync-button`, `sync`) and startup (`server.mjs`) | Sync runs detached but status is a module variable. Restart loses job/progress. `sync_on_start` is implemented by browser sessionStorage and mount. | Persist sync plan/account progress and settings snapshot; atomic admission, resume incomplete read-only accounts on restart. App startup triggers configured sync once per app boot. Browser only observes. | Complete |
| 5 | Scheduler (`schedules`, `server.mjs`) | App owns timer, but occurrence update precedes execution. Concurrent ticks can duplicate runs; crash can lose an occurrence after advancing schedule. | Atomically claim occurrence and persist work with schedule advancement. Recover unfinished occurrences, preserve proposal-only behavior for scheduled Flows. | Complete |
| 6 | Conversation (`workspace-client`, `client-conversation`, `app/page`) | Agent execution already detached and Pi Durable-backed. Active conversation pointer and rendered history only restore through localStorage; fresh browser cannot recover completed conversation. Running reattachment does not render saved events. | Store active conversation pointer in DB, render all saved turns server-side/on reattachment, include tool summaries and artifacts. Browser snapshots are optional caches, not authority. | Complete |
| 7 | Body approvals (`workspace-client`, `agent-runtime`, `agent-body-access`) | Exact request is saved and approved refs are captured by Durable when submitted, but browser marks decision before server acceptance; replay resets every request to pending. Denial is not persisted. | Persist explicit decision against saved request ID; only confirmed snapshot grants access. Restore decision on all views, submit continuation server-side and deduplicate approval submission. | Complete |
| 8 | Agent context/handoff (`client-selection`, `client-rule-selection`, `client-draft-selection`, `client-search-selection`, `client-agent-handoff`) | Selections only localStorage; handoff prompt only sessionStorage. Hard navigation/new browser loses context. | DB-backed shared UI context, server hydration and acknowledged writes before dependent navigation/submission; bounded validated values. Do not mistake shared UI context for durable body/mutation approval. | Complete |
| 9 | Provider login (`provider-auth`, `provider-auth-manager`) | Credentials persisted in SQLite, login prompts/progress and login ID only in-memory/UI. Browser close loses discovery; process restart loses interactive callback. | Persist public login state and discover ongoing login; restore on mount. Restart/expiry produces explicit interrupted state; cannot resume opaque provider OAuth callbacks or persist submitted secrets in progress. | Complete |
| 10 | Draft editor (`drafts-client`) and other forms | Saved drafts, Flows, schedules, accounts, settings, memory already DB-backed. Unsaved draft body only React state. | Persist draft edits before leaving editor and before upload; keep validation/errors visible. Generic unsubmitted confirmation/editor form state can remain transient; it must never be required to run accepted work. | Complete |
| 11 | Read-only UI requests (`inbox-client`, `email-frame`, `client-latest-request`, `folder-manager`, provider/account test/warm) | Browser cancellation suppresses stale UI; does not authorize or cancel mailbox mutations. Body reads use PEEK and cache results, but pending fetches/warm sessions are in-memory optimizations. | Keep cancellation for stale views. Cache fetched data in DB; connection pools/warm sockets may remain ephemeral. Audit errors and refresh/reload behavior; no job needed for every GET. | Complete |
| 12 | Presentation (`generated-workspace`, `history-screen`, settings/memory/schedule UIs, feedback, nav, markdown, local-time, ui primitives) | Generated workspace, History, memory, settings and schedules stored in DB; React manages display and toasts. WebSocket/poll are invalidations, not execution triggers except startup sync above. | Add reconnect/HTTP fallback and durable job visibility where missing. Dialog open/scroll/toast/input focus remains browser presentation. Audit direct callbacks so none schedule accepted work from a mount. | Complete |
| 13 | History list/detail (`history-screen`, History pages) | List/detail are static snapshots and raw event replay dominates progress. | Live list/detail refresh, status counts/filters, clear step receipts, uncertainty, outcome summaries and source links; metadata remains expandable. | Complete |

## Verification required

For each execution path: accepted work finishes with zero connected browsers; reopening a fresh browser renders persisted progress/result; duplicate approvals admit one job; safe queued work survives module/process restart; completed writes never repeat; interrupted claimed writes show `needs_review`, not success and not an automatic retry. Tests use mock transports/synthetic mail; no real mailbox mutation is needed for development verification.

The IMAP server and local SQLite cannot commit an external effect atomically. A persisted claim without receipt is an unknown outcome. Even a multi-command Gmail move can apply a destination label before removing the source label fails. Durable recovery must preserve that distinction.

## Audit coverage

Reviewed all 24 component modules, all client helper modules, all nine API handler modules plus chat, database/store, IMAP sync/body/mutation helpers, drafts/rules/schedules/sync, agent Durable/runtime/approval/classifier/provider code, page loaders, and server startup/scheduler. CSS and rendering primitives have presentation state only. Existing isolated Durable mailbox experiments provide reference tests; they are not live execution paths.

## Change log

- Baseline committed before refactoring. Inventory written before implementation, as requested.

- Item 1: persisted approval queue, exact Flow proposal review, idempotent approval commands, per-message/action receipts and conservative restart recovery. Verified 12 queue/Flow/proposal/History tests; no live mailbox writes.
- Item 2: approved draft content snapshot queued with content-based duplicate protection, saved upload receipt, and protection against overwriting later local edits. Verified queue and draft tests.
- Item 3: confirmed folder/label operations queued by stable command ID; receipts and affected Flow reconciliation saved, completion visible through app-wide jobs/History.
- Item 4: sync accounts/settings/results persisted in the job queue; read-only incomplete accounts resume after restart; startup sync admitted atomically once per app instance, independent of browser mount.
- Item 5: occurrence enqueue and schedule advancement commit atomically; saved occurrence results prevent duplicate proposal creation when a receipt is interrupted. Verified 21 queue/sync/Flow tests.
- Items 6–8: accepted Agent turns now persist in the app queue with a stable Durable submission request ID; completed submissions deduplicate across reopen. Active conversation, exact body decisions, and agent selection/handoff context moved to SQLite. Fresh page loads reconstruct every saved turn. Approved body continuation is queued server-side; denial is persisted. Verified real Durable submission deduplication and synthetic queue/approval tests.

- Additional request: improve History as the durable job/result view, including live status, step progress, source links and uncertainty. Tracked below.

- Item 9: provider login public progress/prompts persisted, active callbacks retained across module reload and discoverable after browser close. Dialog close now hides the view; cancellation is explicit. Opaque OAuth callbacks cannot survive process death, so restored progress explains interruption and requests a new login. Submitted keys/codes are not saved in progress.
- Item 10: draft fields auto-save locally through acknowledged app-state writes; navigation and IMAP upload wait for pending local saves. Agent composer text is persisted too. Save failures remain visible and do not claim acceptance.

- Items 11–12: audited request cancellation, body reads, warm sockets and all component callbacks. IMAP reads preserve unread state with PEEK and cache results in SQLite. Connection pools and stale-view cancellation remain transient optimizations. Cache notifications reconnect, refresh on visibility, and fall back to HTTP polling. No accepted work is started from a browser mount. Startup, scheduler, worker recovery and accepted Agent turns are app-owned.
- Item 13: History refreshes saved list/detail state, groups statuses, exposes confirmed step progress, source links and receipts, and distinguishes uncertain outcomes from success. Completed step receipts and execution metadata are expandable. Prepared activity reflects the saved proposal's eventual outcome. Browser checks at 1440px and 390px found no page errors or horizontal overflow.
- Final safety review: require proposal UIDVALIDITY snapshots, validate them against current sync and the live mailbox, and verify source UID membership before writes. Legacy proposals without a saved mailbox identity must be recreated. Agent cancellation also cancels queued turns; interrupted mailbox claims become explicit uncertain steps without replay.
- Verification: lint, TypeScript, 298 passing tests (one skipped), real Pi Durable request deduplication across reopen, synthetic transport/job recovery tests, and read-only desktop/mobile History navigation. Local dev server runs on port 8765. No real mailbox mutation was performed for development verification.

## Persistence boundaries

Unsaved generic form input, dialog visibility, focus, scroll, sockets and toasts remain presentation state. Accepted work and saved draft/composer/context writes are database-backed. A browser cannot recover edits the server has not acknowledged; the editor shows saving or failure until acceptance. Login callbacks survive closing the browser and module reload; process death requires starting a new OAuth flow, with interrupted public progress retained in SQLite. Uncertain external IMAP effects require review because an IMAP write and a local receipt cannot be committed atomically.

- Live read-only checks: Workspace, Drafts, Flows, Settings and History returned HTTP 200 without page runtime errors. History had zero horizontal overflow at desktop and phone widths. Notification failures cannot stop accepted jobs; an injected disconnect test confirms saved writes still complete.

## Pre-push review, 2026-11-04

Completed Agent commands retain their restored approval context, budgets, and dashboard outcome when the job worker retries the same Durable submission. A runtime regression test verifies that a completed workflow remains complete after reopen and does not create a second dashboard.

The History In progress filter includes queued and running jobs, matching its summary count. Server startup loads Next's environment files before reading the bind address, database path, and trusted origins so the HTTP server and API routes use the same configuration.
