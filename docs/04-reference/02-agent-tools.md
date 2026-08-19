# Agent tools

The agent operates on bounded structured results rather than a preloaded mailbox dump.

- `email_dashboard_snapshot` — compact totals, accounts, recent headers, proposals, and latest workspace.
- `email_facets` — counts grouped by account, age, sender, and domain.
- `email_search` — targeted FTS5/field search with explicit limit, offset, totals, and next offset.
- `email_read_selected` — reads only UI-selected messages through the safe reader.
- `email_propose_organization` — persists an approval-only archive or move proposal.
- `render_workspace` — persists a versioned validated component tree.
- `email_write_artifact` — stores a local note, draft, or supporting artifact.
- Flow tools — create, retrieve, update, preview, and propose editable filters and actions.
- `memory_get`, `memory_list`, `memory_set`, `memory_delete` — CRUD over bounded namespaced SQLite JSON values.

Tools return compact summaries, pagination metadata, and stable account/UID identifiers. The model is instructed to use exact Inbox query syntax and directly addressable Flow routes. Memory is fetched deliberately and is not appended to every turn.
