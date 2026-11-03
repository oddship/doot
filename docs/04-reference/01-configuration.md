# Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `DOOT_HOST` | `127.0.0.1` | HTTP bind address |
| `DOOT_PORT` | `8765` | HTTP port |
| `DOOT_DATABASE_PATH` | `./email-cache.sqlite3` | SQLite database path |
| `DOOT_ALLOWED_ORIGINS` | empty | Comma-separated exact HTTP(S) origins for trusted reverse proxies |
| `DOOT_BASE_URL` | `http://127.0.0.1:8765` | Base URL used by the UI audit |
| `CHROMIUM_PATH` | Playwright browser | Optional system Chromium executable |

`EMAIL_UI_PORT` remains a deprecated compatibility fallback for the port.

HTTP requests require a trusted Host and, when supplied, a trusted Origin. WebSockets require both. Local HTTP origins for `127.0.0.1`, `localhost`, and `[::1]` on the configured port are trusted by default. A specific `DOOT_HOST` is also trusted; wildcard bind addresses do not trust arbitrary hosts. JSON request bodies must use `Content-Type: application/json`.

For a private authenticated reverse proxy, set `DOOT_ALLOWED_ORIGINS` to its exact browser origin, for example `https://your-private-proxy.example`. Restart Doot after changing this setting. Wildcards, credentials, paths, query strings, and fragments are not accepted. Forwarded headers never establish trust. The proxy must preserve the browser Origin and use a trusted Host. This setting does not add authentication: keep Doot behind the proxy's access controls and do not expose it directly to an untrusted network.

Account credentials, model-provider OAuth tokens or API keys, privacy behavior, sync limits, model, and reasoning settings are configured in the application and stored in SQLite. API responses redact stored secrets.

## Mailbox sync scope

Settings offers three synchronization scopes:

- **Inbox only** synchronizes only `INBOX` and remains the upgrade-safe default.
- **Recommended mailbox** synchronizes Gmail's advertised `\\All` folder once, avoiding label-folder duplication. On standard IMAP it synchronizes Inbox plus advertised Archive and Sent folders.
- **Choose folders** synchronizes exact selectable paths from folder discovery. Invalid or empty selections safely fall back to Inbox.

Lookback days and the message target apply independently to each selected folder. A numeric target keeps only that many newest matching headers active; older cached rows and bodies are retained locally but excluded from Inbox, search, Flows, and Agent analysis. Set the target to **All within lookback** to activate every message in the chosen lookback period; the first sync can take substantially longer for large mailboxes. Fetches remain batched and checkpointed. Gmail messages synchronized through overlapping custom labels are shown once using their stable provider ID while their exact source folders remain available for actions. Changing scope deactivates rows from unselected folders but retains their cached bodies for later reuse.

## Model-provider authentication

Doot does not maintain a provider catalog or implement provider-specific OAuth. Settings lists the providers and login methods exposed by Pi's `ModelRuntime`; a small web adapter relays Pi's generic prompts and status events. Pi owns authorization URLs, device codes, token exchange, refresh, and logout. The chat route emits an AI SDK-compatible UI message stream, but provider login remains entirely outside that protocol.

The SQLite credential store implements Pi's `CredentialStore` interface so refreshed OAuth credentials are persisted through the same SDK path. Credentials are redacted from Settings and JSON responses, but v0.1 does not encrypt secrets inside SQLite. Protect the database, its WAL companions, Docker volume, and backups.

## Filesystem

The database parent directory is created automatically. Doot attempts to set the database file to mode `0600`. WAL creates temporary `-wal` and `-shm` companions next to the database; back up and protect the directory as a unit.
