# Agent tools

The agent operates on bounded structured results rather than a preloaded mailbox dump.

- `email_dashboard_snapshot` — compact totals, accounts, recent headers, proposals, and latest workspace.
- `email_facets` — counts grouped by account, age, sender, and domain.
- `email_search` — targeted FTS5/field search with explicit limit, offset, totals, and next offset.
- `email_request_body_access` — displays an explicit browser approval card for exact message references; it does not read bodies.
- `email_read_selected` — reads only UI-selected messages through the safe reader.
- `email_propose_organization` — persists an approval-only archive, move, or delete proposal. Every item must use the exact source folder returned by search; folder-scoped IMAP UIDs are never inferred.
- `email_prepare_draft` — creates or revises a structured local draft; it cannot send mail or write to IMAP.
- `render_workspace` — persists a versioned validated component tree.
- `update_workspace` — applies a minimal validated patch; new top-level batches are prepended like a stack while explicit positions remain available for deliberate reordering.
- `email_write_artifact` — stores a local note, draft, or supporting artifact.
- Flow tools — create, retrieve, update, preview, and propose editable filters and actions.
- `memory_get`, `memory_list`, `memory_set`, `memory_delete` — CRUD over bounded namespaced SQLite JSON values.

Tools return compact summaries, pagination metadata, and stable account/UID identifiers. The model is instructed to use exact Inbox query syntax and directly addressable Flow routes. Memory is fetched deliberately and is not appended to every turn.

When Doot needs an unselected body, it requests access with the exact sender, subject, and stable account/UID references. Approval adds only those messages to the persistent selection and starts a follow-up turn; the safe reader then uses `BODY.PEEK[]`. Denying the card reads nothing.

Selected drafts are resolved from SQLite before a turn so the agent can revise the exact artifact. Saving that artifact to the server-advertised `\Drafts` mailbox is a separate browser-confirmed API action.
