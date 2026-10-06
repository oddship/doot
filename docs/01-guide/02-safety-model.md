# Safety model

Doot separates investigation, proposal, and mutation.

```text
cached mail → agent analysis → workspace / Flow / proposal → human review → confirmed write
```

## Agent boundary

The agent receives aggregates and calls bounded, paginated tools as needed. It does not receive the complete cache by default. Generated workspaces are validated component trees; the model cannot emit executable HTML, CSS, URLs, or arbitrary handlers.

Agent memory is namespaced, size-limited SQLite key/value storage. Memory is retrieved through tools, not automatically appended to every turn.

## Read-only codemode

Doot uses Pi Durable 1.0.3 for the agent loop and reuses Pi's trusted codemode executor. Its registry contains only Doot tools and bounded read-only codemode; no filesystem-discovered extensions, built-in coding tools, or execution environment are installed. The agent can batch header searches, facets, dashboard inspection, folder discovery, Flow inspection, memory reads, and browser-approved body excerpts in a QuickJS sandbox. These tools return structured JSON to scripts. Folder discovery may contact IMAP and refresh the local folder cache, but does not mutate the upstream mailbox.

Script access uses an explicit allowlist, not read-only annotations alone. Every other tool defaults to model-only: approval requests, proposals, drafts, Flow edits, dashboard edits, artifacts, and memory writes remain direct agent tools. Body reads validate exact browser-selected/approved account/folder/UID references inside the tool, including when invoked from scripts. They return at most five plain-text excerpts per call, 6,000 characters per excerpt with truncation metadata and continuation offsets for longer bodies, and 50 distinct bodies per run; no raw HTML or attachment contents. Scripts have no Node, network, shell, MCP, classifier, or image-model access. Email data remains untrusted, including inside scripts.

Host limits override script options: 60 seconds, 2,000 output tokens, 40 tool calls, and four concurrent calls per script. Nested calls pass through schema validation and Doot's tool guards; History records their call and parent IDs. Script store values and exact run approvals/budgets are persisted in Durable conversation documents. The budget is reserved before body fetches. All tools use unsafe replay: interrupted calls report interruption instead of automatically repeating local effects. Durable can resume model generation; it never replays browser mailbox writes. Output truncation may create a local temporary file; protect these files like the mail cache. Calls completed before a script failure are not rolled back.

## Mailbox boundary

The agent cannot call the mailbox mutation function. It can prepare a local proposal or editable Flow. Applying mark-as-read, archive, move, delete, or folder changes requires an explicit browser confirmation through a separate endpoint.

## Reading mail

Sync fetches headers, not bodies. Opening a message uses IMAP `BODY.PEEK[]` so Doot does not intentionally set `\\Seen`. Sanitized HTML renders in a sandboxed iframe; remote images remain blocked unless the user explicitly enables them.

Doot can search cached headers without approval. If message bodies are needed and were not already selected, Doot must show a body-access card naming the exact messages and explaining why. It may request up to 50 exact references or snapshot the browser-selected Inbox search (up to 50 current matches). The card displays the search, account, count, and exact headers. Only **Approve and continue** selects those references and permits the safe reader on the next turn, including codemode; **Not now** reads nothing. Future search matches are never implicitly approved.

## Flow definition management

The agent can list and inspect saved definitions without running them. It can edit the browser-selected Flow or a Flow created by that browser conversation, including prior turns. Creation provenance is recorded in History and can be restored for continued conversations after runtime eviction/restart; inspection alone grants no edit permission. Updates preserve the ID and omitted fields and always set `enabled=false` and return the definition to review. Exact account/query validation and safe move-destination checks still apply. New agent suggestions reject an existing exact account/query pattern atomically, preventing duplicate replacement Flows. Deleting a Flow definition uses the existing browser-confirmed Delete flow action on its review page, not an agent or script mutation. Activation and mailbox execution retain their separate confirmation boundaries.

## Ordered Flow actions

A Flow can mark messages as read on its own, or **mark as read → archive/move/delete**. Other multi-action sequences are rejected. Select the final action in the Flow editor and check **Mark as read before** it; for bank alerts, choose Move, the discovered `transactions` destination, and the read checkbox. Edit the existing Flow rather than creating a duplicate.

Review displays the complete sequence and destination. Running checks that the reviewed account, query, actions, and destination have not changed. Proposals retain their own immutable action snapshot even if the Flow is edited later. Agent edits leave the same Flow disabled for review; they never activate or execute it.

Steps are not an atomic IMAP transaction. Marking read may succeed even if relocation fails. History reports partial failure and completed steps; review those results before retrying. Standalone mark-as-read keeps messages visible in the local cache. Merely reading a message still uses `BODY.PEEK[]` and does not mark it read.

Pi Durable owns live agent conversation execution, not the mailbox-write endpoints. Existing browser conversation IDs and History are preserved. Legacy transcript context is imported once without importing body permissions. See the [transition and recovery operation](../03-development/09-durable-transition.md).

## Deployment boundary

v0.1 is local-only and single-user. It has no login, CSRF defense for an internet-facing deployment, multi-tenant separation, or secret vault integration. Bind to localhost and secure the SQLite database and backups.
