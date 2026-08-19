# Codebase map

```text
app/                 Next.js pages and API route handlers
components/          Product UI and schema-driven workspace renderer
components/ui.tsx    Shared visual primitives
lib/                 Domain, persistence, IMAP, agent, and client helpers
scripts/             Developer and visual-audit automation
tests/               Unit and executable architecture-contract tests
types/               Process-wide TypeScript declarations
public/              Product marks and static assets
docs/                Moat documentation source
.github/             CI, release, Pages, and contribution automation
server.mjs           Next.js + WebSocket process entry point
```

## Module ownership

- `lib/database.ts` owns connection setup, migrations, settings defaults, and indexed query primitives.
- `lib/store.ts` is the compatibility command boundary used by routes and agent tooling. New domain behavior should live in a focused module and be called from this boundary.
- `lib/imap.ts` owns safe connection, sync, read, and mutation operations; provider-specific mailbox semantics live in `mail-provider.ts` and `imap-folder.ts`.
- `lib/agent-runtime.ts` owns session lifecycle and tool translation. Workspace validation lives separately in `workspace.ts` and patching in `workspace-patch.ts`.
- Client persistence helpers isolate browser selection, conversation, and Flow-selection state from page components.

## Organization rule

Prefer a focused domain module over adding another large branch to a UI component or `store.ts`. Keep API parsing thin, persistence explicit, and safety checks close to the operation they protect.
