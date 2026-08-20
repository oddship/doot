# Codebase map

```text
app/                 Next.js pages and API route handlers
app/styles/          Ordered global cascade split by UI responsibility
components/          Product UI and schema-driven workspace renderer
components/ui.tsx    Shared visual primitives
demo-site/           Export-only Next app and frozen fictional API responses
lib/                 Domain, persistence, IMAP, agent, and client helpers
scripts/             Developer and visual-audit automation
tests/               Unit and executable architecture-contract tests
types/               Process-wide TypeScript declarations
public/              Product marks and static assets
docs/                Moat source, pinned base layout, and branded docs theme
.github/             CI, release, Pages, and contribution automation
server.mjs           Next.js + WebSocket process entry point
```

## Module ownership

- `lib/database.ts` owns connection setup, migrations, settings defaults, and indexed query primitives.
- `lib/store.ts` is the compatibility command boundary used by routes and agent tooling. New domain behavior should live in a focused module and be called from this boundary.
- `lib/api/` contains the typed catch-all API dispatcher and bounded domain handlers. `app/api/[...path]/route.ts` only adapts Next.js requests and centralizes error responses.
- `lib/imap.ts` owns safe connection, sync, read, and mutation operations; provider-specific mailbox semantics live in `mail-provider.ts` and `imap-folder.ts`.
- `lib/agent-runtime.ts` owns session lifecycle and tool translation. Workspace validation lives separately in `workspace.ts` and patching in `workspace-patch.ts`.
- Client persistence helpers isolate browser selection, conversation, and Flow-selection state from page components.
- Production screens stay data-driven and are shared with the static demo; `demo-site` may adapt transport and navigation but must not reimplement those screens.
- `app/globals.css` is an import manifest. Foundation, screen, theme, responsive, and feature rules stay in ordered files under `app/styles/`; preserve import order when cascade precedence matters.

## Organization rule

Prefer a focused domain module over adding another large branch to a UI component or `store.ts`. Keep API parsing thin, persistence explicit, and safety checks close to the operation they protect.
