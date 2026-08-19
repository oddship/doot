# Doot v0.1 product specification

## Problem

Large inboxes are working archives, but conventional clients make broad analysis difficult and autonomous agents make mailbox changes difficult to trust. Doot should provide emergent analysis without surrendering control.

## Product principles

1. **Agent first, user sovereign.** Doot investigates proactively and prepares useful actions; the user approves mailbox writes.
2. **The cache is a dataset.** SQLite aggregates and FTS5 let the agent inspect all cached mail through bounded tools instead of stuffing messages into prompts.
3. **Generated, not arbitrary.** Workspaces compose audited UI primitives and validated intents.
4. **Flows are first-class.** Reusable email filters combine a query with archive, move, or delete; users can inspect, edit, preview, discuss, and run them.
5. **Local by default.** Mail, credentials, history, and memory remain in the local SQLite database unless the selected model provider receives explicitly delegated context.

## v0.1 requirements

- Multi-account IMAP configuration, connection tests, folder discovery/CRUD, incremental sync, and per-account progress.
- Paginated cached Inbox with search, account filter, cross-page selection, and a safe reading pane.
- Persistent agent conversations, manual Organize, selected-message context, tool/reasoning visibility, and generated workspaces.
- Editable Flows and proposals with a mandatory browser confirmation before mutation.
- Read-only History for agent sessions and sync jobs.
- Provider, model, reasoning, sync, privacy, memory, and delegation settings.
- Local Node, Nix, and Docker developer/runtime paths.

## Explicitly out of scope

- Hosted multi-user service, authentication, teams, and remote administration.
- SMTP sending, reply delivery, calendar, contacts, and attachment editing.
- Scheduled sync or autonomous model runs.
- Autonomous application of mailbox mutations.
- Full offline mirror fidelity across every IMAP extension and provider.
- Mobile-native clients and browser extensions.

## Success criteria

- A run continues while navigating and is recoverable after reopening the workspace.
- Search and analysis operate over the complete synced cache with pagination.
- No agent-generated path can directly mutate IMAP.
- An opened message does not become seen due to Doot.
- A fresh contributor can run checks through npm, Nix/direnv, or documented Docker workflows.
