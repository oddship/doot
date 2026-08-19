# Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `DOOT_HOST` | `127.0.0.1` | HTTP bind address |
| `DOOT_PORT` | `8765` | HTTP port |
| `DOOT_DATABASE_PATH` | `./email-cache.sqlite3` | SQLite database path |
| `DOOT_BASE_URL` | `http://127.0.0.1:8765` | Base URL used by the UI audit |
| `CHROMIUM_PATH` | Playwright browser | Optional system Chromium executable |

`EMAIL_UI_PORT` remains a deprecated compatibility fallback for the port.

Account credentials, provider API keys, privacy behavior, sync limits, model, and reasoning settings are configured in the application and stored in SQLite. API responses redact stored secrets.

## Filesystem

The database parent directory is created automatically. Doot attempts to set the database file to mode `0600`. WAL creates temporary `-wal` and `-shm` companions next to the database; back up and protect the directory as a unit.
