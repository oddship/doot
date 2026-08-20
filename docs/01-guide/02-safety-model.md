# Safety model

Doot separates investigation, proposal, and mutation.

```text
cached mail → agent analysis → workspace / Flow / proposal → human review → confirmed write
```

## Agent boundary

The agent receives aggregates and calls bounded, paginated tools as needed. It does not receive the complete cache by default. Generated workspaces are validated component trees; the model cannot emit executable HTML, CSS, URLs, or arbitrary handlers.

Agent memory is namespaced, size-limited SQLite key/value storage. Memory is retrieved through tools, not automatically appended to every turn.

## Mailbox boundary

The agent cannot call the mailbox mutation function. It can prepare a local proposal or editable Flow. Applying archive, move, delete, or folder changes requires an explicit browser confirmation through a separate endpoint.

## Reading mail

Sync fetches headers, not bodies. Opening a message uses IMAP `BODY.PEEK[]` so Doot does not intentionally set `\\Seen`. Sanitized HTML renders in a sandboxed iframe; remote images remain blocked unless the user explicitly enables them.

Doot can search cached headers without approval. If a message body is needed and was not already selected, Doot must show a body-access card naming the exact messages and explaining why. Only **Approve and continue** selects those references and permits the safe reader on the next turn; **Not now** reads nothing.

## Deployment boundary

v0.1 is local-only and single-user. It has no login, CSRF defense for an internet-facing deployment, multi-tenant separation, or secret vault integration. Bind to localhost and secure the SQLite database and backups.
