# Doot v0.1 product specification

## Problem

Large inboxes are working archives, but conventional clients make broad analysis difficult and autonomous agents make mailbox changes difficult to trust. Doot should provide emergent analysis without surrendering control.

## Product principles

1. **Agent first, user sovereign.** Doot investigates proactively and prepares useful actions; the user approves mailbox writes.
2. **The cache is a dataset.** SQLite aggregates and FTS5 let the agent inspect all cached mail through bounded tools instead of stuffing messages into prompts.
3. **Generated, not arbitrary.** Workspaces compose audited UI primitives and validated intents.
4. **Flows are first-class.** Reusable email filters combine a query with archive, move, or delete; users can inspect, edit, preview, discuss, and run them.
5. **Drafts are review-first.** Doot may prepare or revise a local draft using explicitly available cache context, but only the user can confirm saving it to IMAP; sending is out of scope.
6. **One activity ledger.** Agent conversations, sync jobs, Flow evaluations, schedules, proposals, and mailbox actions are inspectable in History.
7. **Local by default.** Mail, credentials, history, and memory remain in the local SQLite database unless the selected model provider receives explicitly delegated context.

## v0.1 requirements

- Multi-account IMAP configuration, connection tests, folder discovery/CRUD, incremental sync, and per-account progress.
- Paginated cached Inbox with search, account filter, cross-page selection, and a safe reading pane.
- Persistent agent conversations, manual Organize, selected-message context, tool/reasoning visibility, and generated workspaces.
- Editable Flows and proposals with a mandatory browser confirmation before mutation.
- Structured local drafts, persistent draft context in chat, and confirmation-only IMAP Drafts persistence.
- Filterable History for Agent conversations, sync jobs, Flow runs, schedules, proposals, account changes, folder changes, drafts saved to IMAP, and applied mailbox actions.
- Persisted once, daily, and weekly schedules for read-only sync and review-only Flow evaluation.
- Pi-discovered provider OAuth/API-key login and logout, model and reasoning selection, plus sync, privacy, memory, and delegation settings.
- Local Node, Nix, and Docker developer/runtime paths.

## Explicitly out of scope

- Hosted multi-user service, authentication, teams, and remote administration.
- SMTP sending, reply delivery, calendar, contacts, and attachment editing.
- Calendar expressions, remote wakeups, or schedules that run while the local Doot process is stopped.
- Scheduled or autonomous model runs.
- Autonomous application of mailbox mutations.
- Full offline mirror fidelity across every IMAP extension and provider.
- Mobile-native clients and browser extensions.

## Success criteria

- A run continues while navigating and is recoverable after reopening the workspace.
- Search and analysis operate over the complete synced cache with pagination.
- No agent-generated path can directly mutate IMAP.
- An opened message does not become seen due to Doot.
- A fresh contributor can run checks through npm, Nix/direnv, or documented Docker workflows.
