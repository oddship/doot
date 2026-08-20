# Doot

**A trusted, local-first emissary for your inbox.**

Doot connects to IMAP, maintains a searchable local cache, and gives a constrained agent the tools to investigate that cache. It turns analysis into safe generated workspaces, editable Flows, and reviewable proposals while leaving mailbox authority with the user.

## Start here

- [Open the frozen interactive demo](https://oddship.github.io/doot/demo/)
- [Getting started](01-guide/01-getting-started.md)
- [Safety model](01-guide/02-safety-model.md)
- [Flow lifecycle and activation](01-guide/04-flows.md)
- [v0.1 product specification](02-product/01-product-spec.md)
- [Architecture](03-development/01-architecture.md)
- [Configuration](04-reference/01-configuration.md)

## Release status

v0.1 is intended for local, single-user evaluation. It has no authentication and must not be exposed to the public internet.

The hosted demo is a deterministic Next.js static export backed by frozen, fictional API responses. It contacts no external service and cannot connect to mail.
