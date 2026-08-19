# Changelog

All notable changes are documented here. Doot follows semantic versioning from v0.1 onward.

## [0.1.0] - 2026-08-20

### Added

- Agent-first workspace with streamed reasoning, tool calls, persistent conversations, and safe generated UI.
- Incremental multi-account IMAP sync, folder discovery and CRUD, cached FTS5 search, and a safe email reader.
- Approval-driven proposals and editable Flows for archive, move, and delete operations.
- Session and sync-job History, durable bounded agent memory, settings, account, and provider management.
- Biome, Husky, lint-staged, Nix/direnv, Just, Docker Compose, CI, release, container, and Moat Pages workflows.

### Safety

- Mailbox writes remain impossible without an explicit browser confirmation.
- Remote email images are blocked by default and HTML is sanitized before sandboxed rendering.
