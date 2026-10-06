<p align="center">
  <img src="public/doot-logo.svg" width="280" alt="Doot by Oddship" />
</p>

<p align="center"><strong>A trusted, local-first emissary for your inbox.</strong></p>

<p align="center"><a href="https://oddship.github.io/doot/demo/"><strong>Try the frozen demo →</strong></a></p>

<p align="center">
  <a href="https://oddship.github.io/doot/demo/"><img src="docs/_static/doot-demo.png" width="1200" alt="Doot demo workspace with fictional email data" /></a>
</p>

Doot is an agent-first email workspace that investigates a local IMAP cache, builds useful views, and prepares reviewable actions. It never silently mutates your mailbox: archive, move, delete, folder, and Flow operations cross an explicit browser confirmation boundary.

> Doot is an early v0.1 release. Run it locally, keep backups, and review every proposed mailbox action.

## What it does

- Connects IMAP accounts, discovers provider folders, and incrementally syncs message headers using an Inbox-only, provider-recommended, or custom folder scope.
- Searches the complete cache with SQLite FTS5 and fetches bodies only when opened via `BODY.PEEK[]`.
- Gives the agent paginated search, aggregation, selected-message, proposal, Flow, artifact, and bounded memory tools.
- Batches header analysis, Flow inspection, and browser-approved body excerpts in Pi's read-only sandboxed codemode; scripts cannot create proposals, edit Flows or drafts, mutate memory, or access mailbox writes.
- Approves up to 50 bodies as an exact snapshot of the current Inbox search, then reviews them in bounded batches. The agent can refine selected or conversation-created Flows without duplicating them.
- Prepares structured local drafts with Doot, then saves them to the account's advertised IMAP Drafts folder only after explicit confirmation.
- Streams agent reasoning and tool progress into a persistent workspace that survives navigation.
- Renders agent responses as safe GitHub-flavored Markdown without raw HTML or remote images.
- Generates safe component specs—never model-authored HTML, CSS, URLs, or event handlers.
- Replays Agent conversations, sync jobs, Flow runs, schedules, proposals, and mailbox actions from a filterable History ledger.
- Schedules read-only sync or review-only Flow evaluations for once, daily, or weekly execution while Doot is running.

## Quick start

Requirements: Node.js 22 LTS and npm. Agent features also need a model provider connected through OAuth or an API key.

```bash
cp .env.example .env
npm ci
npm run dev
```

Open <http://127.0.0.1:8765>. In Settings, connect a model provider using one of the methods advertised by Pi, select a model, then add and sync an email account. Doot stores provider tokens, account credentials, and cached mail in the local SQLite database configured by `DOOT_DATABASE_PATH`; protect that file and never commit it.

With Nix and direnv:

```bash
direnv allow
just setup
just dev
```

With Docker:

```bash
docker compose up --build
```

The Compose volume `doot-data` retains the SQLite database. See [configuration](docs/04-reference/01-configuration.md) before exposing the container beyond localhost.

## Development

```bash
just check       # lint, type-check, and unit/contract tests
just build       # production build
just ui-check    # screenshot and widescreen regression audit; server must be running
just audit       # production dependency audit
npm run bench:imap-reads  # synthetic body-fetch latency benchmark; no mailbox access
npm run bench:queries     # local query benchmark on a private temporary cache copy
```

Pre-commit hooks run Biome through lint-staged. Run `npm run prepare` after cloning if npm did not install hooks automatically.

## Architecture

```text
Browser ── Next.js + React ── SQLite/FTS5
   │             ├────────── Pi agent runtime
   │             └────────── ImapFlow ── IMAP
   └── SSE (agent run) + WebSocket (background status)
```

Body reads are cache-first, coalesced, and batched while preserving `BODY.PEEK[]`; see [IMAP performance and timing metrics](docs/03-development/05-imap-performance.md). Canonical searches use lightweight key ranking, and facet/dashboard aggregates share work; see [local query performance](docs/03-development/06-query-performance.md). The Inbox also avoids redundant renders, reconnects, and stale requests; see [UI performance](docs/03-development/07-ui-performance.md).

Flows support mark-as-read on its own or before archive/move/delete, with complete-plan review and partial-failure reporting. See the [Flow guide](docs/01-guide/04-flows.md). An isolated `npm run prototype:durable` evaluates restart/approval/cancellation recovery using a fake mailbox; see the [Pi Durable assessment](docs/03-development/08-durable-recovery.md). The live agent now uses Pi Durable for conversation transcripts, run context, and recovery; mailbox mutations remain outside the agent behind browser confirmation. See the [transition plan and operation](docs/03-development/09-durable-transition.md).

One Node process owns Next.js, the Pi runtime, SQLite, IMAP operations, API routes, SSE, and WebSocket events. There is no Python service. See the [architecture guide](docs/03-development/01-architecture.md) and [codebase map](docs/03-development/02-codebase.md).

## Safety model

- Organization is manually initiated; sync and startup do not trigger the model.
- Generated workspaces contain validated primitives and validated action intents.
- The agent creates local proposals; only browser-confirmed endpoints apply mailbox writes.
- An active Flow is reviewed and eligible for attached schedules; scheduled evaluations prepare proposals, never automatic mailbox mutations.
- Draft composition stays local until the user confirms an IMAP append; Doot never sends messages.
- Generated organization workspaces may suggest deletion, but deletion remains a manual Inbox proposal and confirmation flow.
- Remote images are blocked by default; HTML is sanitized and rendered in a sandboxed iframe.
- Doot is local-only and has no authentication in v0.1.

Read the complete [safety model](docs/01-guide/02-safety-model.md) and [security policy](SECURITY.md).

## Documentation

The source in [`docs/`](docs/) is published with [Oddship Moat](https://github.com/oddship/moat) at <https://oddship.github.io/doot/>. Product scope and decisions live in the [v0.1 product specification](docs/02-product/01-product-spec.md).

The [frozen demo](https://oddship.github.io/doot/demo/) is a real Next.js static export generated reproducibly from Doot's production screen components and versioned, fictional API responses by `npm run demo:build`. It contacts no external service and has no mailbox access. Run it locally with `npm run demo:serve`, and regenerate its README screenshot with `npm run demo:screenshot`.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT © Oddship contributors. See [LICENSE](LICENSE).
