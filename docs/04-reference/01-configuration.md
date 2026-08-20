# Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `DOOT_HOST` | `127.0.0.1` | HTTP bind address |
| `DOOT_PORT` | `8765` | HTTP port |
| `DOOT_DATABASE_PATH` | `./email-cache.sqlite3` | SQLite database path |
| `DOOT_BASE_URL` | `http://127.0.0.1:8765` | Base URL used by the UI audit |
| `CHROMIUM_PATH` | Playwright browser | Optional system Chromium executable |

`EMAIL_UI_PORT` remains a deprecated compatibility fallback for the port.

Account credentials, model-provider OAuth tokens or API keys, privacy behavior, sync limits, model, and reasoning settings are configured in the application and stored in SQLite. API responses redact stored secrets.

## Model-provider authentication

Doot does not maintain a provider catalog or implement provider-specific OAuth. Settings lists the providers and login methods exposed by Pi's `ModelRuntime`; a small web adapter relays Pi's generic prompts and status events. Pi owns authorization URLs, device codes, token exchange, refresh, and logout. AI SDK is used for the chat stream and has no provider-login facility.

The SQLite credential store implements Pi's `CredentialStore` interface so refreshed OAuth credentials are persisted through the same SDK path. Credentials are redacted from Settings and JSON responses, but v0.1 does not encrypt secrets inside SQLite. Protect the database, its WAL companions, Docker volume, and backups.

## Filesystem

The database parent directory is created automatically. Doot attempts to set the database file to mode `0600`. WAL creates temporary `-wal` and `-shm` companions next to the database; back up and protect the directory as a unit.
