# Getting started

## Native Node

Install Node.js 22 or 23, then:

```bash
cp .env.example .env
npm ci
npm run dev
```

Open `http://127.0.0.1:8765`. In Settings, add an IMAP account, test the connection, add a provider key, and choose the model. Sync is always explicit.

## Nix and direnv

The flake provides Node, Chromium, SQLite, Just, Python for native npm builds, and pkg-config.

```bash
direnv allow
just setup
just dev
```

## Docker Compose

```bash
docker compose up --build
```

The app listens on port 8765 and stores its database in the `doot-data` volume. Container networking publishes the port to the host; restrict it with a firewall and do not deploy this unauthenticated v0.1 image publicly.

## First run

1. Add and test an account in Settings.
2. Sync headers. The job appears in History and continues independently of navigation.
3. Browse Inbox; opening a message fetches its body without marking it read.
4. Select messages across pages to include them in agent context.
5. Start Organize manually or ask a focused question.
6. Review any proposed Flow or mailbox action before confirming it.
