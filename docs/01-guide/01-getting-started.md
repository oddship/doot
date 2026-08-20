# Getting started

## Native Node

Install Node.js 22 or 23, then:

```bash
cp .env.example .env
npm ci
npm run dev
```

Open `http://127.0.0.1:8765`. In Settings, connect a model provider with one of the sign-in methods exposed by Pi, choose a model, add an IMAP account, and test the connection. Sync is always explicit.

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

The app listens on `127.0.0.1:8765` and stores its database in the `doot-data` volume. OAuth device-code flows work directly. If a provider instead redirects to a loopback URL that is not reachable outside the container, its Pi flow asks you to paste the final redirect URL or authorization code back into Settings. Do not deploy this unauthenticated v0.1 image publicly.

## First run

1. Connect a model provider in Settings and select one of its available models.
2. Add and test an email account in Settings.
3. Sync headers. The job appears in History and continues independently of navigation.
4. Browse Inbox; opening a message fetches its body without marking it read.
5. Select messages across pages to include them in agent context.
6. Start Organize manually or ask a focused question.
7. Review any proposed Flow or mailbox action before confirming it.

Marking a Flow active only records that its definition is reviewed and ready for manual use. It does not run automatically. See [Flow lifecycle and activation](04-flows.md).
